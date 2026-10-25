# Prompt for Claude Code (desktop): testing against a real OPNsense

Paste the block below into Claude Code on the machine that can reach the Proxmox host or the OPNsense. Decide first: **Option A** (your own OPNsense with a read-only API key, faster and more realistic) or **Option B** (a fresh OPNsense VM on Proxmox, no risk for the home network). Delete the option you do not use from the prompt.

---

```text
You are working on "OPNsense Insight", a statistics dashboard for OPNsense in the
style of the UniFi Network dashboard (Node.js >= 22.13, no npm dependencies,
SQLite via node:sqlite, vanilla JS frontend without a build step).
Repo: https://github.com/DieSteinhose/opnsense-dashboard
Branch: create a branch "verify/real-opnsense" from main and work ONLY there.
README.md explains the architecture and data sources. Read it first.

The code was written WITHOUT access to a real OPNsense, based only on the docs and
the OPNsense source code (opnsense/core). A demo mode (npm run demo) works.
Your task: verify the code against a real OPNsense, fix bugs, and confirm or
correct the assumptions below.

== Environment ==
[OPTION A – existing OPNsense]
- OPNsense reachable at: <enter URL, e.g. https://192.168.1.1>
- Create (or let me create) a user "insight" with READ-ONLY privileges and an API
  key. Do NOT change firewall rules, interfaces or services.
  No POST requests except diagnostics/firewall/query_states (it is only a query).

[OPTION B – test VM on Proxmox]
- Proxmox host: <enter host/IP>, access: <enter SSH/API token>
- Create an OPNsense VM (current ISO from opnsense.org, 2 vCPU, 4 GB RAM, 20 GB):
  vtnet0 = WAN on the bridge with internet access (DHCP), vtnet1 = LAN on a new
  isolated bridge (e.g. vmbr99, 192.168.99.1/24, DHCP on).
- Create a small Linux VM/LXC (Debian) on vmbr99 as the "client".
- In OPNsense: keep Unbound as the resolver (default), create API user + key.
- Generate realistic traffic on the client so there is something to measure:
  * a large download over HTTPS (e.g. a Debian ISO with curl, note the rate)
  * Steam-like: curl a Steam CDN host in a loop, e.g.
    https://cdn.cloudflare.steamstatic.com/steam/apps/570/header.jpg
  * Usenet-like: openssl s_client -connect news.eweka.nl:563 (a connection is enough)
  * DNS queries through the OPNsense (dig @192.168.99.1 ...)
  * an IPv6 case if the WAN has IPv6

== Procedure ==
1. Clone the repo, check out the branch, `cp .env.example .env`, fill in values.
2. `npm test` (must pass), then `npm run probe`. Read the output and
   data/probe.json. Investigate every FAIL line.
3. `npm start`, open the dashboard on :8080, take a screenshot with Playwright or
   the browser, compare the numbers with OPNsense (Reporting > Traffic,
   Diagnostics > States).

== Assumptions to verify ==
A1  POST /api/diagnostics/firewall/query_states returns rows[] with id, direction
    ("in"/"out"), src_addr, dst_addr, dst_port, proto and bytes as an array [a, b].
A2  For an outbound connection of a LAN client, bytes[0] = upload
    (client -> internet) and bytes[1] = download. Check with a large download:
    the growing value must be bytes[1]. If it is the other way round, fix
    pollStates in collector.js.
A3  Every connection appears once with direction "in" (LAN side) and possibly once
    with "out" (WAN side/NAT). The collector only counts "in". Check that nothing is
    counted twice AND nothing is missed (also with floating rules, iface = "all",
    and with IPv6 without NAT).
A4  For large downloads, the sum of services (Top services, footer "x % attributed")
    is close to the WAN interface bytes. Note the "Not tracked" share.
A5  GET /api/diagnostics/traffic/interface: keys are interface keys (wan, lan, opt1)
    with "bytes received"/"bytes transmitted". WAN "received" = download.
A6  GET /api/diagnostics/traffic/top/lan: records[] with address, rate_bits_in,
    rate_bits_out, details[]. Is rate_bits_in really the download of a LAN client?
    ("Active now" list, "Clients" tab)
A7  GET /api/unbound/diagnostics/dumpcache: {status, data:[{host, rrtype, value}]};
    the domain mapping (Top destinations) shows real names like debian.org /
    steamstatic.com.
A8  The paths exist in the installed version: diagnostics/system/system_time,
    system_resources, system_information, routes/gateway/status,
    diagnostics/interface/get_arp, get_ndp, get_interface_config.
A9  Local networks are detected correctly from get_interface_config (dashboard
    footer). With IPv6 prefix delegation: does the LAN /64 count as local?
A10 Runtime of query_states with many states (e.g. 5000+): does the poll stay below
    the 15 s interval? Watch the load on the OPNsense (top).
A11 Which privileges does the API user need at minimum? Correct the README section
    "Creating the API user in OPNsense" with the real names.

== Rules ==
- Keep the project's code style (ES modules, no new npm dependencies).
- For every confirmed or refuted assumption, add a short entry to
  docs/VERIFICATION.md (assumption, result, OPNsense version, fix if any).
- Add tests to test/core.test.js when you change logic. `npm test` must pass.
- Do not commit secrets, real public IPs or MAC addresses
  (data/ and .env are in .gitignore; probe.json stays local).
- Push commits with clear messages to the branch above, then open a PR against main
  so the Docker workflow tests the changes.
- Briefly test both languages (LANGUAGE=de and LANGUAGE=en).
- At the end: a summary of what works, what was fixed and what is still open.

Optional, if there is time: install the os-ntopng plugin and check which REST
endpoints (v2) provide per-host application statistics (nDPI protocols such as
"Steam", "BitTorrent"). Write the result as a proposal into docs/VERIFICATION.md,
do not implement it yet.
```
