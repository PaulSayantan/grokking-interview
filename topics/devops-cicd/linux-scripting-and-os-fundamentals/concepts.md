# Linux, Shell Scripting & OS Fundamentals (DevOps toolkit)

This topic is the **hands-on Linux toolkit** every DevOps/platform engineer is expected to
wield in an interview and on the job: writing safe **bash scripts**, driving the **essential
CLI** (`grep`/`sed`/`awk`/`find`/`xargs`), diagnosing a box with **process and resource
tools** (`ps`/`top`/`df`/`ss`/`lsof`), reasoning about **file permissions**, managing
services with **systemd**, and knowing where **logs**, **cron**, **SSH keys**, and
**env vars** live. It is the glue under CI runners, container entrypoints, cloud-init
scripts, and incident debugging.

> [!KEY-TAKEAWAY]
> Interviewers here want *practical fluency*, not kernel theory. Be able to: write a script
> that fails loudly (`set -euo pipefail`), read an exit code (`$?`, `0` = success), find the
> process eating CPU (`top`) or holding a port (`ss -ltnp` / `lsof -i`), decode `rwxr-xr--`,
> restart and inspect a service (`systemctl` + `journalctl -u`), and schedule a job (`cron`
> / systemd timer). This is the *ops* view of Linux — deep OS internals (scheduling, memory
> management, filesystems) belong to the upcoming **operating-systems** domain; cross-link
> there for the *why-under-the-hood*.

---

## Bash scripting fundamentals

A shell script is a text file of commands run by an interpreter. The first line — the
**shebang** — names that interpreter:

```bash
#!/usr/bin/env bash
```

`#!/usr/bin/env bash` finds `bash` on `PATH` (more portable than a hardcoded `#!/bin/bash`,
which matters on macOS/BSD where bash may live elsewhere). The file must be **executable**
(`chmod +x script.sh`) to run as `./script.sh`; otherwise invoke it explicitly as
`bash script.sh`.

**Variables** have no spaces around `=`, and you *dereference* with `$`:

```bash
name="prod"          # assignment: NO spaces around =
echo "$name"         # use: $name or ${name}
count=$((1 + 2))     # arithmetic expansion
```

**Quoting is the #1 bash bug source.** Always double-quote expansions (`"$var"`,
`"$@"`) so values with spaces or glob characters are not word-split or expanded:

| Form | Behavior |
|---|---|
| `"$var"` | Expands variables, preserves the value as one word (**use this**) |
| `'$var'` | Literal — single quotes suppress **all** expansion |
| `$var` (unquoted) | Word-split on `$IFS` and glob-expanded — dangerous |
| `` `cmd` `` / `$(cmd)` | Command substitution (prefer `$(...)`, it nests) |

`sh` is not `bash`: on many systems `/bin/sh` is `dash` (POSIX-only). Arrays,
`[[ ... ]]`, and `set -o pipefail` are bashisms that break under `sh`, so the shebang must
match the features you use.

> [!INTERVIEW]
> "Why `#!/usr/bin/env bash` over `#!/bin/bash`?" → `env` resolves bash via `PATH`, so the
> script works where bash lives in a non-standard location (e.g. Homebrew bash on macOS,
> or a newer bash first on `PATH`). Trade-off: you lose the ability to pass a fixed
> interpreter path, and `env` can't easily pass args on Linux.

---

## Variables, conditionals, loops, and functions

**Conditionals** use `test` / `[ ]` (POSIX) or `[[ ]]` (bash, safer — no word-splitting,
supports `&&`, `=~` regex):

```bash
if [[ -f "$file" && -s "$file" ]]; then      # exists AND non-empty
  echo "have file"
elif [[ "$env" == prod* ]]; then             # pattern match
  echo "prod-like"
else
  echo "other"
fi
```

Common test operators: `-f` (regular file), `-d` (dir), `-e` (exists), `-s` (non-empty),
`-z "$s"` (empty string), `-n "$s"` (non-empty string), `-eq/-ne/-lt/-gt` (numeric),
`==`/`!=` (string). `[[ ... ]]` uses `==`; `-eq` is for integers.

**Loops:**

```bash
for f in *.log; do echo "$f"; done            # glob
for i in {1..5}; do echo "$i"; done           # brace range
while read -r line; do echo "$line"; done < input.txt   # read a file safely
```

Always `read -r` (raw) so backslashes aren't mangled, and quote the loop variable.
Iterating over `$(ls)` is an anti-pattern (breaks on spaces/newlines); glob directly.

**Functions** return an **exit status** (0–255), not a value; "return data" via `echo` +
command substitution. `local` scopes variables:

```bash
retry() {
  local attempts=$1; shift
  for ((i = 1; i <= attempts; i++)); do
    "$@" && return 0
    sleep $((i * 2))
  done
  return 1
}
retry 3 curl -fsS https://example.com/health
```

`$1..$9` / `${10}` are positional args, `$@` is all args (quote as `"$@"` to preserve each
as a separate word), `$#` is the count, `$0` is the script name.

---

## Exit codes and `$?`

Every command returns an **exit status**: `0` means **success**, any non-zero (`1`–`255`)
means failure. `$?` holds the status of the **last** command:

```bash
grep -q ERROR app.log
echo $?        # 0 if a match was found, 1 if none, 2 on error
```

Conventions worth knowing:

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | General/catch-all error |
| `2` | Misuse of shell builtin / bad arguments |
| `126` | Command found but **not executable** |
| `127` | Command **not found** |
| `128 + N` | Terminated by signal `N` (e.g. `130` = 128+2 = Ctrl-C/SIGINT, `137` = 128+9 = SIGKILL, `143` = 128+15 = SIGTERM) |

`exit N` sets a script's status. This is the backbone of CI/CD: a pipeline **step fails
when its command exits non-zero**, so scripts must propagate real statuses (don't swallow
errors) and `exit 1` on failure. `&&` runs the next command only on success, `||` only on
failure. In a pipeline `a | b`, `$?` is the exit status of the **last** command (`b`) by
default — see `pipefail` below.

> [!WARNING]
> `137` (SIGKILL, 128+9) in a container/CI log is almost always the **OOM killer** or a
> resource limit terminating your process, not a bug in your code. `143` (SIGTERM) means
> something asked it to stop gracefully (orchestrator scale-down, `docker stop`, job
> cancellation).

---

## set -euo pipefail (safe scripting)

Default bash keeps going after errors and treats unset variables as empty — silent, subtle
bugs. The near-universal "strict mode" preamble:

```bash
set -euo pipefail
IFS=$'\n\t'
```

| Flag | Effect |
|---|---|
| `set -e` (`errexit`) | Exit immediately if any command returns non-zero (with caveats) |
| `set -u` (`nounset`) | Error on use of an **unset** variable — catches typos |
| `set -o pipefail` | A pipeline fails if **any** command in it fails (status = the last/rightmost command that exited non-zero), not just the final command |
| `IFS=$'\n\t'` | Word-split only on newline/tab, not spaces — safer `for`/`read` |

Why `pipefail` matters: without it, `curl badurl | tee out.txt` reports **success** because
`tee` succeeded — the failing `curl` is masked. With `pipefail`, the pipeline fails.

`set -e` **gotchas** (classic interview traps):
- It does *not* trigger for commands in `if`/`while`/`&&`/`||` conditions, or those followed
  by `||`.
- A failing command in a function called in a conditional won't abort.
- `local x=$(cmd)` masks `cmd`'s failure because `local`'s own exit status (0) wins — split
  the declaration from the assignment.

Add `trap 'echo "failed at line $LINENO" >&2' ERR` for diagnostics and
`trap cleanup EXIT` to guarantee cleanup on any exit path.

---

## Pipes, redirection, and command substitution

Every process has three standard streams: **stdin** (fd 0), **stdout** (fd 1), **stderr**
(fd 2). Redirection rewires them:

```bash
cmd > out.txt        # stdout to file (truncate)
cmd >> out.txt       # stdout appended
cmd 2> err.txt       # stderr to file
cmd > all.txt 2>&1   # stdout AND stderr to file (order matters!)
cmd &> all.txt       # bash shorthand for the above
cmd < in.txt         # stdin from file
cmd 2>/dev/null      # discard stderr
```

**Order matters:** `> file 2>&1` sends stdout to the file *then* points stderr at "wherever
stdout now goes" (the file). Reversing it — `2>&1 > file` — points stderr at the *terminal*
(stdout's original target) and only stdout to the file. This is a favorite gotcha.

**Pipes** connect one command's stdout to the next's stdin: `ps aux | grep nginx | wc -l`.
Pipes carry **stdout only** — errors on stderr bypass the pipe unless you `2>&1` first.

**Command substitution** captures a command's output as text: `$(...)` (preferred, nests
cleanly) or backticks. **Process substitution** `<(...)` presents a command's output as a
file: `diff <(sort a) <(sort b)`.

A **here-doc** feeds inline multi-line stdin:

```bash
cat <<'EOF' > /etc/app/config
literal $text, no expansion because EOF is quoted
EOF
```

Quote the delimiter (`<<'EOF'`) to suppress variable expansion inside the body.

---

## Essential text & search CLI (grep, find, xargs, cut, sort, uniq)

The bread-and-butter filters. Know these cold:

- **`grep`** — search text. `-i` ignore case, `-v` invert, `-r` recursive, `-n` line
  numbers, `-c` count, `-E` extended regex, `-o` only match, `-q` quiet (exit-code only),
  `-A/-B/-C N` context lines. `grep -rn "TODO" src/`.
- **`find`** — walk the filesystem by predicate. `find /var/log -name '*.log' -mtime +7
  -delete` (files older than 7 days). `-type f/d`, `-size +100M`, `-exec cmd {} \;` (per
  file) or `-exec cmd {} +` (batched).
- **`xargs`** — build command lines from stdin. `find . -name '*.tmp' -print0 | xargs -0 rm`
  handles filenames with spaces (`-print0`/`-0` use NUL separators). `-n1`, `-P4` (parallel).
- **`cut`** — extract columns: `cut -d: -f1 /etc/passwd` (usernames). `-d` delimiter,
  `-f` fields, `-c` chars.
- **`sort`** — `-n` numeric, `-r` reverse, `-k2` by 2nd field, `-u` unique, `-h`
  human-readable sizes.
- **`uniq`** — collapse **adjacent** duplicates (so `sort | uniq` first); `-c` count,
  `-d` only dupes. `sort access.log | uniq -c | sort -rn | head` = top lines.
- **`wc`** — `-l` lines, `-w` words, `-c` bytes.
- **`tr`** — translate/delete chars: `tr 'A-Z' 'a-z'`, `tr -d '\r'`.
- **`head`/`tail`** — first/last N lines (`-n`). **`tail -f`** follows a growing file live
  (`-F` re-opens on rotation) — the classic "watch the log" move.
- **`less`** — pager; `/` search, `G` end, `F` follow like `tail -f`, `q` quit.

The canonical one-liner interviewers love: *"top 10 client IPs in an access log"* →
`awk '{print $1}' access.log | sort | uniq -c | sort -rn | head`.

---

## sed and awk

Two mini-languages for stream editing and column processing.

**`sed`** — stream editor, line-oriented substitution:

```bash
sed 's/old/new/g' file          # substitute all on each line
sed -i.bak 's/8080/9090/g' cfg   # in-place edit, keep .bak backup
sed -n '10,20p' file             # print only lines 10-20
sed '/^#/d' file                 # delete comment lines
```

`-i` edits in place (always keep a suffix like `-i.bak` for safety and macOS-compat), `-n`
suppresses default printing, `p` prints, `d` deletes, `g` = global (all matches on a line).

**`awk`** — field-oriented pattern-action processor. Splits each line into fields (`$1`,
`$2`, … `$NF` = last, `$0` = whole line) on whitespace by default:

```bash
awk '{print $1, $NF}' file            # first and last field
awk -F: '{print $1}' /etc/passwd      # custom field separator
awk '$3 > 1000 {print $1}' data       # condition then action
awk '{sum += $2} END {print sum}' f   # accumulate, print at END
df -h | awk 'NR>1 && $5+0 > 80 {print $6, $5}'   # mounts over 80% full
```

`-F` sets the field separator, `NR` = record (line) number, `NF` = field count, `BEGIN`/`END`
blocks run before/after processing. Rule of thumb: **`grep` to find lines, `sed` to edit
lines, `awk` to work with columns/aggregate.**

---

## Processes and signals

A **process** is a running program with a PID. Inspect and control them:

- **`ps`** — snapshot. `ps aux` (BSD style: all users, detailed) or `ps -ef` (System V).
  `ps aux --sort=-%mem | head` = biggest memory hogs.
- **`top`** / **`htop`** — live, interactive process/resource monitor. In `top`: `P` sort by
  CPU, `M` by memory, `k` kill, `1` per-core view. `htop` is friendlier (color, scrollable,
  tree view) but not installed by default.
- **`pgrep`/`pkill`** — find/signal by name: `pkill -f gunicorn`.
- **`nice`/`renice`** — set scheduling priority (**niceness** −20 highest to +19 lowest;
  higher nice = "nicer" = lower priority). `nice -n 10 heavy_job`. `ionice` for I/O priority.

**Signals** are asynchronous notifications to a process. `kill -SIGNAL PID` sends one
(`kill` despite its name just *signals*):

| Signal | Num | Meaning / behavior |
|---|---|---|
| `SIGTERM` | 15 | **Polite** "please stop" — catchable, lets the app clean up. **Default of `kill`.** |
| `SIGKILL` | 9 | **Forceful** kill — **uncatchable, uncleanable**, kernel removes the process. Last resort. |
| `SIGINT` | 2 | Interrupt (Ctrl-C) |
| `SIGHUP` | 1 | Hangup — often repurposed to "reload config" (e.g. nginx) |
| `SIGSTOP`/`SIGCONT` | 19/18 | Pause / resume |

Graceful shutdown pattern: send **SIGTERM**, wait, then **SIGKILL** if it hasn't exited.
This is exactly what `docker stop`, Kubernetes pod termination, and systemd do — apps should
**trap SIGTERM** to drain connections and flush state. `kill -9` (SIGKILL) skips cleanup, so
prefer it only when SIGTERM is ignored.

> [!INTERVIEW]
> "Difference between SIGTERM and SIGKILL?" → SIGTERM (15) is a **graceful, catchable**
> request — the app can trap it, finish in-flight work, and exit cleanly; it's what `kill`
> and orchestrators send first. SIGKILL (9) **cannot be caught, blocked, or handled** — the
> kernel kills the process immediately with no cleanup, risking corrupted state or leaked
> resources. Always try SIGTERM first.

---

## File permissions and ownership

Every file has an **owner (user)**, a **group**, and three permission triads — **user /
group / other** — each with **read (r=4), write (w=2), execute (x=1)**.

```
-rwxr-xr--  1 deploy  web  4096 Jul 18 10:00 deploy.sh
 │└┬┘└┬┘└┬┘    └──┬─┘ └┬┘
 │ u  g  o      owner group
 type
```

- On a **file**: `r` read contents, `w` modify, `x` execute.
- On a **directory**: `r` list names, `w` create/delete entries, **`x` enter/traverse**
  (you need `x` to `cd` in or access files by path — a dir with `r` but no `x` lets you see
  names but not use them).

**`chmod`** changes mode; **`chown`** changes owner/group:

```bash
chmod 755 script.sh      # rwxr-xr-x (octal: 7=rwx,5=r-x,5=r-x)
chmod +x script.sh       # add execute for all
chmod u+w,g-w,o= file    # symbolic
chmod 600 id_rsa         # rw for owner only — SSH keys MUST be tight (or SSH refuses them)
chown deploy:web app.log # owner deploy, group web
chmod -R 750 /srv/app    # recursive
```

Octal digit = sum of r(4)+w(2)+x(1): `7`=rwx, `6`=rw-, `5`=r-x, `4`=r--, `0`=---. A leading
digit sets special bits: **setuid (4)**, **setgid (2)**, **sticky (1)**. The **sticky bit**
on `/tmp` (`1777`) means only a file's owner can delete it even though the dir is
world-writable. **setuid** on a binary makes it run as the file's owner (that's how
`passwd`/`sudo` work) — a big security-review area.

**`umask`** subtracts from default perms for newly created files (common `022` → new files
`644`, dirs `755`). **`sudo`** runs a command as another user (root by default) per
`/etc/sudoers`; prefer it over logging in as root, and it leaves an audit trail.

---

## systemd and services (systemctl, journalctl)

**systemd** is the init system (PID 1) and service manager on virtually all modern Linux
distros (Ubuntu, RHEL/CentOS/Fedora, Debian, Amazon Linux 2/2023). It starts services,
tracks dependencies, restarts crashed units, and captures their logs.

**`systemctl`** controls **units** (services, sockets, timers, mounts):

```bash
systemctl start   nginx           # start now
systemctl stop    nginx
systemctl restart nginx
systemctl reload  nginx           # re-read config without full restart (if supported)
systemctl status  nginx           # state + recent log lines + PID
systemctl enable  nginx           # start on boot (creates symlink)
systemctl enable --now nginx      # enable + start in one shot
systemctl daemon-reload           # reload unit files after editing them
systemctl list-units --failed     # what's broken
```

> [!WARNING]
> `enable` vs `start` is a classic trip-up: **`start`** runs it *now* (this boot only);
> **`enable`** makes it start *on boot* (persistent) but does **not** start it now. You
> usually want both — `enable --now`. And after editing any unit file you must
> `systemctl daemon-reload` before the change takes effect.

A minimal **unit file** (`/etc/systemd/system/myapp.service`):

```ini
[Unit]
Description=My App
After=network.target

[Service]
ExecStart=/usr/bin/myapp --port 8080
Restart=on-failure
RestartSec=5
User=appuser
Environment=ENV=prod
EnvironmentFile=/etc/myapp/env

[Install]
WantedBy=multi-user.target
```

`Restart=on-failure` gives you supervision/auto-restart for free. `WantedBy=multi-user.target`
is what `enable` hooks into for boot start.

**`journalctl`** reads systemd's binary journal (logs):

```bash
journalctl -u nginx              # logs for one unit
journalctl -u nginx -f           # follow live (like tail -f)
journalctl -u nginx --since "1 hour ago"
journalctl -p err -b             # priority error+, this boot
journalctl -n 100 --no-pager
```

**systemd timers** are the modern cron alternative (`.timer` + `.service` pair) — they get
journald logging, dependency ordering, and `OnCalendar=`/`OnBootSec=` schedules. Cron is
still ubiquitous and simpler; timers win when you want logging and integration with the
service manager.

---

## Package managers (apt, yum, dnf)

Distros ship a **package manager** that installs software plus its dependencies from
**repositories**, verifying signatures.

| Family | Distros | Tools | Package format |
|---|---|---|---|
| Debian/Ubuntu | Debian, Ubuntu | `apt` / `apt-get`, `dpkg` | `.deb` |
| Red Hat | RHEL, CentOS, Fedora, Amazon Linux | `dnf` (modern), `yum` (legacy alias), `rpm` | `.rpm` |
| SUSE | openSUSE, SLES | `zypper` | `.rpm` |
| Alpine | Alpine (containers) | `apk` | `.apk` |

```bash
# Debian/Ubuntu
apt-get update                 # refresh package index FIRST
apt-get install -y nginx       # -y for non-interactive (scripts/CI)
apt-get remove / purge nginx
dpkg -l | grep nginx           # query installed

# RHEL/Fedora/Amazon Linux
dnf install -y nginx           # dnf update refreshes as part of the txn
dnf remove nginx
rpm -qa | grep nginx           # query installed
```

DevOps gotchas: always `apt-get update` before `install` (a stale index installs old or
missing packages). In Dockerfiles, combine update+install+cleanup in **one** `RUN` layer and
`rm -rf /var/lib/apt/lists/*` to keep images small. `apt` (the friendly CLI) is for
interactive use; **`apt-get`/`apt-cache` have a stable interface meant for scripts**.

---

## Cron and scheduled jobs

**cron** runs commands on a schedule. Each user has a **crontab** (`crontab -e` to edit,
`crontab -l` to list); system-wide entries live in `/etc/crontab` and `/etc/cron.d/`. The
five time fields:

```
┌ minute (0-59)
│ ┌ hour (0-23)
│ │ ┌ day-of-month (1-31)
│ │ │ ┌ month (1-12)
│ │ │ │ ┌ day-of-week (0-7, 0 & 7 = Sunday)
│ │ │ │ │
* * * * *  command
```

Examples: `*/15 * * * *` (every 15 min), `0 2 * * *` (daily 02:00), `0 0 * * 0` (Sundays
midnight), `0 9 * * 1-5` (weekdays 09:00). Shorthands: `@daily`, `@hourly`, `@reboot`.

> [!WARNING]
> Cron runs jobs in a **minimal environment** — `PATH` is short, `$HOME` may differ, and
> your shell profile is **not** sourced. The #1 cron bug is "works in my shell, fails in
> cron" due to `PATH`/env differences: use **absolute paths** for binaries and files, set
> needed vars explicitly, and redirect output (`>> /var/log/job.log 2>&1`) because cron
> otherwise emails stdout/stderr into the void. Also mind the timezone (often UTC on
> servers) and DST edge cases.

For distributed/observable scheduling prefer **systemd timers** (logging, missed-run
`Persistent=true`) or a scheduler in the platform (Kubernetes CronJobs, cloud schedulers).

---

## SSH and keys

**SSH** (Secure Shell) is encrypted remote login and the transport under `scp`, `sftp`,
`rsync`, `git` over SSH, and Ansible. **Key-based auth** replaces passwords with an
asymmetric keypair:

```bash
ssh-keygen -t ed25519 -C "deploy@ci"     # generate (ed25519 preferred over RSA)
# creates ~/.ssh/id_ed25519 (PRIVATE — keep secret) and id_ed25519.pub (PUBLIC)
ssh-copy-id user@host                     # append pubkey to remote ~/.ssh/authorized_keys
ssh -i ~/.ssh/id_ed25519 user@host
```

- The **private key never leaves the client**; the **public key** goes in the server's
  `~/.ssh/authorized_keys`. The server proves you hold the private key without it crossing
  the wire.
- **Permissions matter:** SSH refuses to use keys that are group/other-readable —
  `~/.ssh` must be `700`, private key `600`, `authorized_keys` `600`. This is a frequent
  "why won't it authenticate" bug.
- `~/.ssh/config` sets per-host defaults (User, IdentityFile, Port, ProxyJump for bastion
  hops). `ssh-agent` caches decrypted keys so you type the passphrase once. **Host keys** in
  `~/.ssh/known_hosts` protect against MITM (the "authenticity can't be established" prompt).

In CI/CD, deploy keys or short-lived certificates authenticate to servers/registries; for
cloud provider auth, **OIDC federation** (covered in `devops-cicd/secrets-management`) is
preferred over long-lived SSH keys or static credentials.

---

## Environment variables and PATH

**Environment variables** are key-value pairs inherited by child processes — the standard
way to pass config (12-Factor App config-in-environment).

```bash
export DB_HOST=db.internal    # export → visible to child processes
echo "$DB_HOST"
env | sort                    # list all env vars
printenv PATH
unset DB_HOST
DEBUG=1 ./run.sh              # set for a single command's environment only
```

Without `export`, a variable is a **shell variable** — visible to the current shell but
**not inherited** by child processes. `export` promotes it to the environment.

**`PATH`** is a colon-separated list of directories the shell searches for commands, left to
right. `which cmd` / `command -v cmd` shows which one wins; `type cmd` also reveals aliases
and builtins. Prepending (`PATH="/opt/bin:$PATH"`) makes your dir win over system binaries.

> [!WARNING]
> **Never put `.` (current directory) in `PATH`**, especially before system dirs — a
> malicious `ls` dropped in a directory you `cd` into would run instead of the real one.
> This is a real privilege-escalation vector.

Load order (login vs non-login, interactive vs not) determines which files set vars:
`/etc/profile` and `~/.bash_profile`/`~/.profile` for login shells, `~/.bashrc` for
interactive non-login. Scripts and cron get a **minimal** environment, so never rely on
your interactive `.bashrc` being present — set what you need explicitly.

---

## Disk, memory, and network diagnostics

The "the box is sick, diagnose it" toolkit:

**Disk:**
- **`df -h`** — free space per **filesystem** (human-readable). `df -i` shows **inode**
  usage — a disk can be "full" on inodes (millions of tiny files) while `df -h` shows free
  space, a classic gotcha.
- **`du -sh *`** — size **used** by files/dirs (summarize, human). `du -sh * | sort -h`
  finds the big directories. `df` = filesystem view, `du` = per-path view; they can disagree
  when a deleted file is still **held open** by a process (space not reclaimed until the fd
  closes — find it with `lsof | grep deleted`).

**Memory:**
- **`free -h`** — total/used/free/**available** RAM and swap. Look at **`available`**, not
  `free`: Linux uses spare RAM for **buff/cache**, which is reclaimable, so low "free" is
  normal and healthy. High **swap** usage + slowness signals memory pressure.

**Network / ports:**
- **`ss -ltnp`** — listening (`-l`) TCP (`-t`) sockets, numeric (`-n`), with process (`-p`).
  Modern replacement for `netstat -ltnp`. "What's listening on :8080?" → `ss -ltnp | grep 8080`.
- **`lsof -i :8080`** — which process holds a port; `lsof -p PID` lists a process's open
  files/sockets; `lsof +D /path` who has files under a dir open.
- **`ip a`** (addresses), **`ip r`** (routes) — replace the deprecated `ifconfig`/`route`.

For deeper resource internals (page cache, OOM scoring, TCP state machine) see the upcoming
**operating-systems** and the authored **networking** domain; here it's about *reading the
tools fast during an incident*.

---

## Log locations and inspection

Where things log on a typical Linux server:

| Location | Contents |
|---|---|
| `/var/log/syslog` (Debian) / `/var/log/messages` (RHEL) | General system messages |
| `/var/log/auth.log` / `/var/log/secure` | Auth, sudo, SSH logins |
| `journalctl` (systemd journal) | Per-unit service logs (binary, query with `journalctl -u`) |
| `/var/log/nginx/`, `/var/log/<app>/` | App/service-specific logs |
| `dmesg` / `journalctl -k` | Kernel ring buffer (OOM kills, hardware, driver messages) |

Core inspection moves: **`tail -f /var/log/app.log`** to watch live, **`grep -i error`** to
filter, **`less +F`** to page and follow, **`journalctl -u svc -f`** for systemd services.
The OOM-killer message ("Out of memory: Killed process") shows up in `dmesg`/`journalctl -k`
and correlates with a `137` exit code.

**Log rotation** via **`logrotate`** (`/etc/logrotate.d/`) prevents disks filling: it
rotates, compresses, and prunes logs on size/time triggers. A full `/var/log` filling the
root filesystem is a common incident — `df -h` then `du -sh /var/log/*` to find the culprit.
In cloud/container setups, logs are shipped to a central store (CloudWatch, ELK, Loki); how
that ties into the delivery pipeline (deploy markers, post-deploy smoke checks) lives in
`devops-cicd/monitoring-and-observability`, and the metrics/logs/traces discipline itself is
the authored **observability** domain.

---

## Common follow-up questions

- **"Walk me through debugging a server that's slow / out of disk / has a port conflict."**
  Slow: `top`/`htop` for CPU, `free -h` for memory pressure/swap, `iostat`/`iotop` for I/O,
  `ss`/`ping` for network. Disk full: `df -h` (also `df -i` for inodes), then `du -sh /*` to
  drill down, check for open-but-deleted files with `lsof | grep deleted`. Port conflict:
  `ss -ltnp | grep :PORT` or `lsof -i :PORT` to find the owning PID, then decide.
- **"Your bash script silently ignored a failure — why, and how do you prevent it?"**
  Default bash continues past errors and pipelines report only the last command's status.
  Add `set -euo pipefail`; be aware `set -e` is suppressed inside `if`/`&&`/`||` and by
  `local x=$(cmd)`.
- **"How do you keep a service running and see its logs?"** Run it under systemd with
  `Restart=on-failure`, `systemctl enable --now`, and read logs via `journalctl -u`.
- **"grep vs sed vs awk — when do you reach for each?"** grep to *find* matching lines, sed
  to *edit/substitute* lines in a stream, awk to work with *columns* and *aggregate*.
- **"Why did my SSH key stop working after I copied it?"** Permissions — SSH ignores keys
  and `~/.ssh` that are too open; need `700` on `~/.ssh`, `600` on the private key.
- **"Cron job works when I run it but not from cron."** Minimal cron environment: short
  `PATH`, no profile sourced. Use absolute paths and set env explicitly; redirect output.
- **"What does exit code 137 mean in a CI/container log?"** 128 + 9 = killed by SIGKILL,
  usually the OOM killer / a memory limit.
- **"SIGTERM vs SIGKILL, and why do orchestrators send SIGTERM first?"** SIGTERM is
  catchable and lets the app drain/clean up; SIGKILL is immediate and uncatchable. Graceful
  shutdown needs the app to trap SIGTERM.

## References

- The Linux Documentation Project — *Advanced Bash-Scripting Guide* (tldp.org)
- GNU Bash Reference Manual (gnu.org/software/bash/manual)
- `man` pages: `bash(1)`, `chmod(1)`, `find(1)`, `awk(1)`, `sed(1)`, `signal(7)`,
  `systemd.service(5)`, `systemd.timer(5)`, `crontab(5)`, `ssh_config(5)`, `sudoers(5)`
- systemd documentation — freedesktop.org/software/systemd (`systemctl`, `journalctl`)
- Google — *Shell Style Guide* (google.github.io/styleguide/shellguide.html)
- "Use the Unofficial Bash Strict Mode" — Aaron Maxwell (redsymbol.net/articles/unofficial-bash-strict-mode)
- ShellCheck (shellcheck.net) — static analysis for shell scripts
- Debian `apt`/`dpkg` and Fedora `dnf` documentation
- The 12-Factor App — Config (12factor.net/config) for env-var configuration
- Cross-references: `devops-cicd/monitoring-and-observability`, `devops-cicd/secrets-management`,
  the authored **observability** and **networking** domains, and the upcoming
  **operating-systems** domain for kernel/OS internals.
