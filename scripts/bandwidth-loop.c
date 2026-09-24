// Prints "[tx_bps,rx_bps,tx_today_bytes,rx_today_bytes,"local_ip",
// "iface",is_vpn]\n" every 3s for the interface holding the default
// route, read straight from /proc/net/dev. Ported from the old rice's
// bandwidth-loop-ags.c; changes from that version:
//
// 1. The running daily total is persisted next to the compiled binary
//    under /tmp/ags-<user>/ instead of ~/.config/ags/ — this project's
//    ~/.config/ags is a symlink into the repo, so writing there would
//    leave a log file sitting in git status.
// 2. A 5th field: the IPv4 address bound to the SAME interface the
//    bandwidth numbers come from. Re-resolving the default-route
//    interface every iteration (already needed for the byte counters)
//    is what makes this VPN-aware for free — the moment a VPN comes up
//    and takes over the default route, `get_default_interface()` starts
//    returning the tunnel device (tun0/wg0/...) instead of the physical
//    NIC, and this address follows it. This is the LOCAL address on
//    that interface, not the public IP a remote site would see — the
//    AGS side fetches that separately (widget/bar/BandwidthMenu.tsx).
// 3. A 6th field (the interface name, for the bar's VPN indicator's
//    tooltip) and a 7th (is_vpn, 0/1). is_vpn is NOT a name match
//    (tun*/wg*/...) — those prefixes vary by software (WireGuard's
//    default is wg0, but NordVPN's NordLynx is nordlynx, Tailscale is
//    tailscale0, some corporate clients use ppp0 or something
//    vendor-named) and no fixed prefix list covers all of them. Instead:
//    a REAL network card always has a `/sys/class/net/<iface>/device`
//    symlink back to the PCI/USB hardware behind it; a virtual interface
//    (any VPN tunnel, plus loopback/bridges/etc, none of which normally
//    hold the default route) does not. This is the same distinction
//    NetworkManager itself uses to separate hardware from software
//    devices, so it holds regardless of which VPN client eventually
//    gets installed here.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <time.h>
#include <sys/stat.h>
#include <sys/socket.h>
#include <sys/ioctl.h>
#include <net/if.h>
#include <arpa/inet.h>
#include <limits.h>
#include <errno.h>

#define MAX_IFACE_NAME 16
#define LOG_FILE "bandwidth.log"
#define DATE_FORMAT "%04d-%02d-%02d"
#define DATE_LEN 11

typedef struct {
    unsigned long long rx;
    unsigned long long tx;
} BandwidthData;

typedef struct {
    char log_path[PATH_MAX];
} AppContext;

/* ---------- Utility ---------- */

static void handle_error(const char *msg, int exit_code) {
    fprintf(stderr, "Error: %s\n", msg);
    exit(exit_code);
}

static double seconds_delta(struct timespec *a, struct timespec *b) {
    return (b->tv_sec - a->tv_sec) +
           (b->tv_nsec - a->tv_nsec) / 1e9;
}

static void get_current_date(char *date_str) {
    time_t t = time(NULL);
    struct tm tm = *localtime(&t);
    snprintf(date_str, DATE_LEN, DATE_FORMAT,
             tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday);
}

/* ---------- Local IP ---------- */

// Empty string (not an error exit) if the interface has no IPv4
// address at this instant — real during the brief window right after
// a VPN interface appears in /proc/net/route but before it's finished
// bringing its address up. The JSON field is just "" then; the JS side
// keeps showing the last-known value rather than blanking on a glitch.
static void get_iface_ip(const char *iface, char *out, size_t outlen) {
    out[0] = '\0';

    int fd = socket(AF_INET, SOCK_DGRAM, 0);
    if (fd < 0) return;

    struct ifreq ifr;
    memset(&ifr, 0, sizeof(ifr));
    ifr.ifr_addr.sa_family = AF_INET;
    strncpy(ifr.ifr_name, iface, IFNAMSIZ - 1);

    if (ioctl(fd, SIOCGIFADDR, &ifr) == 0) {
        struct sockaddr_in *sin = (struct sockaddr_in *)&ifr.ifr_addr;
        const char *addr = inet_ntoa(sin->sin_addr);
        if (addr) snprintf(out, outlen, "%s", addr);
    }

    close(fd);
}

// See the file header for why this is "no backing hardware device"
// rather than a name-prefix guess.
static int is_vpn_interface(const char *iface) {
    char path[PATH_MAX];
    snprintf(path, sizeof(path), "/sys/class/net/%s/device", iface);
    return access(path, F_OK) != 0;
}

/* ---------- Interface detection ---------- */

static char *get_default_interface() {
    FILE *file = fopen("/proc/net/route", "r");
    if (!file)
        handle_error("Unable to open /proc/net/route", 1);

    char buffer[256];
    char iface[MAX_IFACE_NAME] = {0};
    unsigned long destination;

    fgets(buffer, sizeof(buffer), file); // skip header

    while (fgets(buffer, sizeof(buffer), file)) {
        if (sscanf(buffer, "%15s %lx", iface, &destination) == 2 &&
            destination == 0) {
            fclose(file);
            return strdup(iface);
        }
    }

    fclose(file);
    return NULL;
}

/* ---------- Path helpers ---------- */

static void init_context(AppContext *ctx) {
    // Run from the same directory as the compiled binary (argv[0]'s
    // directory) — that is always the /tmp/ags-<user> scratch dir this
    // is built into, never a path baked in at compile time.
    char self[PATH_MAX];
    ssize_t n = readlink("/proc/self/exe", self, sizeof(self) - 1);
    if (n <= 0)
        handle_error("Failed to resolve /proc/self/exe", 1);
    self[n] = '\0';

    char *slash = strrchr(self, '/');
    if (slash) *slash = '\0';

    snprintf(ctx->log_path, PATH_MAX, "%s/%s", self, LOG_FILE);
}

/* ---------- Fast /proc/net/dev parser ---------- */

static inline int fast_parse_dev(const char *line,
                                const char *iface,
                                BandwidthData *out) {
    const char *p = strchr(line, ':');
    if (!p) return 0;

    size_t len = p - line;
    while (len && line[0] == ' ') { line++; len--; }

    if (strncmp(line, iface, len) != 0 || iface[len] != '\0')
        return 0;

    p++; // after ':'

    unsigned long long rx, tx;
    if (sscanf(p, "%llu %*u %*u %*u %*u %*u %*u %*u %llu",
               &rx, &tx) == 2) {
        out->rx = rx;
        out->tx = tx;
        return 1;
    }
    return 0;
}

// Returns 0 if the interface isn't in /proc/net/dev right now — real,
// briefly, mid-VPN-transition (the route appears before the device is
// fully up). *out is left zeroed; the caller skips the tick rather than
// dying, since this process is meant to run for the life of the AGS
// session, through however many VPN connects/disconnects that includes.
static int get_interface_bytes(const char *iface, BandwidthData *out) {
    FILE *file = fopen("/proc/net/dev", "r");
    if (!file)
        return 0;

    char buffer[256];
    *out = (BandwidthData){0};
    int found = 0;

    fgets(buffer, sizeof(buffer), file); // skip headers
    fgets(buffer, sizeof(buffer), file);

    while (fgets(buffer, sizeof(buffer), file)) {
        if (fast_parse_dev(buffer, iface, out)) {
            found = 1;
            break;
        }
    }

    fclose(file);
    return found;
}

/* ---------- Log handling ---------- */

static void read_today_bandwidth(const char *path,
                                 BandwidthData *today) {
    FILE *file = fopen(path, "r");
    if (!file) {
        today->rx = today->tx = 0;
        return;
    }

    char current_date[DATE_LEN];
    get_current_date(current_date);

    char line[256];
    char date[DATE_LEN];
    BandwidthData data = {0};

    while (fgets(line, sizeof(line), file)) {
        if (sscanf(line, "%10s %llu %llu",
                   date, &data.tx, &data.rx) == 3) {
            if (strcmp(date, current_date) == 0) {
                *today = data;
                break;
            }
        }
    }

    fclose(file);
}

static void update_today_bandwidth(const char *path,
                                   const BandwidthData *data) {
    char current_date[DATE_LEN];
    get_current_date(current_date);

    char temp_path[PATH_MAX];
    snprintf(temp_path, sizeof(temp_path), "%s.tmp", path);

    FILE *temp = fopen(temp_path, "w");
    if (!temp)
        handle_error("Failed to create temp file", 1);

    FILE *file = fopen(path, "r");
    if (file) {
        char line[256];
        char date[DATE_LEN];

        while (fgets(line, sizeof(line), file)) {
            if (sscanf(line, "%10s", date) == 1 &&
                strcmp(date, current_date) != 0) {
                fputs(line, temp);
            }
        }
        fclose(file);
    }

    fprintf(temp, "%s %llu %llu\n",
            current_date, data->tx, data->rx);
    fclose(temp);

    if (rename(temp_path, path)) {
        unlink(temp_path);
        handle_error("Failed to update log file", 1);
    }
}

/* ---------- MAIN ---------- */

int main() {
    AppContext ctx;
    init_context(&ctx);

    BandwidthData today = {0};
    read_today_bandwidth(ctx.log_path, &today);

    char iface[MAX_IFACE_NAME] = {0};
    BandwidthData old = {0};
    struct timespec t1;
    int have_baseline = 0;

    while (1) {
        usleep(3000000);   // 3s: low CPU + smooth updates

        // Re-resolved every tick, not once at startup: this process
        // outlives however many times you connect or disconnect a VPN
        // in a session, and the default route — hence which interface
        // "the" bandwidth even means — can change under it at any time.
        char *cur = get_default_interface();
        if (!cur) continue; // between routes (e.g. VPN handshake); try again next tick

        int changed = strncmp(cur, iface, MAX_IFACE_NAME) != 0;
        if (changed) strncpy(iface, cur, MAX_IFACE_NAME);
        free(cur);

        BandwidthData now;
        if (!get_interface_bytes(iface, &now)) continue; // device not fully up yet

        char ip[64];
        get_iface_ip(iface, ip, sizeof(ip));
        int vpn = is_vpn_interface(iface);

        struct timespec t2;
        clock_gettime(CLOCK_MONOTONIC, &t2);

        // A fresh interface has no prior sample to diff against — the
        // old rice's bug class here was computing a "rate" between two
        // DIFFERENT interfaces' counters (or wrapped u64 subtraction
        // when the new interface's counters start below the old one's),
        // which spikes to some nonsense multi-GB/s reading for one tick
        // right as a VPN connects. Report zero instead, just this once.
        if (changed || !have_baseline) {
            old = now;
            t1 = t2;
            have_baseline = 1;
            printf("[0,0,%llu,%llu,\"%s\",\"%s\",%d]\n",
                   today.tx, today.rx, ip, iface, vpn);
            fflush(stdout);
            continue;
        }

        double dt = seconds_delta(&t1, &t2);
        t1 = t2;

        unsigned long long d_rx = now.rx - old.rx;
        unsigned long long d_tx = now.tx - old.tx;

        BandwidthData speed = {
            (unsigned long long)(d_rx / dt),
            (unsigned long long)(d_tx / dt)
        };

        today.rx += d_rx;
        today.tx += d_tx;

        update_today_bandwidth(ctx.log_path, &today);

        printf("[%llu,%llu,%llu,%llu,\"%s\",\"%s\",%d]\n",
               speed.tx, speed.rx,
               today.tx, today.rx, ip, iface, vpn);
        fflush(stdout);

        old = now;
    }

    return 0;
}
