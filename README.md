# Shopify Partner Dashboard

Self-hosted dashboard for Shopify app developers. Connect your Partner API
token and it tracks installs, uninstalls and active stores per app, then lets
you build email flows, sequences and campaigns that fire off those events.

- **Apps & stores** — every app on your Partner account, with install/uninstall
  history and per-store detail
- **Flows** — event-triggered email automation (install, uninstall, custom)
- **Sequences** — multi-step drip campaigns with delays between steps
- **Campaigns** — one-off broadcasts to a filtered merchant list

---

## Read this first

**You do not need to know how to code to install this.** Every command you need
is written out below, in order, for **Windows, macOS and Ubuntu** separately.

The database is **MySQL**, and the project talks to it through **Prisma** — the
tool that creates and updates the tables for you. So the database work is only:
install MySQL → run four SQL lines to make an empty database → let Prisma build
all the tables with one command.

**How to follow this guide:** type (or paste) one command into a black window
called the terminal, press **Enter**, wait for the blinking cursor to come back,
then move to the next command. After most steps there is a *"What you should
see"* block — if your screen roughly matches it, carry on. If it does not, find
your error message in [Troubleshooting](#troubleshooting); nearly every
first-time problem is listed there with its fix.

Set aside about 30–45 minutes for the first install.

### What you will end up with

The dashboard running on your own computer at `http://localhost:3000`, with its
own MySQL database on that same computer, showing your own Shopify apps. Nothing
is shared with anyone else and none of your keys leave your machine.

### What you need before starting

- A computer running Windows 10/11, macOS, or Ubuntu (or another Linux).
- A [Shopify Partner account](https://partners.shopify.com) — free.
- About 2 GB of free disk space.
- Optionally, if you want the dashboard to send email: a
  [Brevo](https://www.brevo.com) account **or** any email account with SMTP
  access (Gmail, Zoho, Outlook, your own server). You choose between them inside
  the app later — neither is needed to get the dashboard running.

### The whole install at a glance

| Part | What you do | Roughly |
|---|---|---|
| 1 | Install MySQL and Node.js | 15 min |
| 2 | Open a terminal | 1 min |
| 3 | Download the project | 3 min |
| 4 | `npm install` | 5 min |
| 5 | Create the database (4 SQL lines) | 5 min |
| 6 | Fill in 4 settings in a file | 5 min |
| 7 | Let Prisma create the tables (1 command) | 1 min |
| 8 | Create your login (1 command) | 1 min |
| 9 | Start it | 1 min |

---

# Part 1 — Install the two programs you need

| Program | What it is | Why you need it |
|---|---|---|
| **MySQL Server 8** | The database | Stores every install, store, email and setting |
| **Node.js 20 or newer** | The engine that runs JavaScript | Runs the dashboard itself |

Install MySQL first, then Node.js.

---

## 1a. Install MySQL — Windows

**Step 1.** Go to
[dev.mysql.com/downloads/installer](https://dev.mysql.com/downloads/installer/)
and download **MySQL Installer for Windows**. You are offered two files — take
the **larger** one (about 300 MB); the small one downloads everything during
setup and fails on a poor connection. On the next page click the small link
**"No thanks, just start my download"** — you do not need an Oracle account.

**Step 2.** Run the downloaded `.msi` file.

**Step 3.** On the **Choosing a Setup Type** screen, select **Server only**, then
click **Next** → **Execute**. Wait for the green tick, then **Next**.

> *Server only* is deliberate. "Developer Default" also installs Workbench,
> connectors and sample data that you will never use here.

**Step 4.** On **Type and Networking**, change nothing — *Development Computer*,
**Port 3306**, *Open Windows Firewall port* ticked. Click **Next**.

**Step 5.** On **Authentication Method**, leave the first option — *Use Strong
Password Encryption for Authentication* — selected. Click **Next**.

**Step 6.** On **Accounts and Roles**, type a **MySQL Root Password** twice.

> ⚠️ **Write this password down now, somewhere you will still have it next
> month.** It is the master password for your database. There is no "forgot
> password" link — recovering it means reinstalling MySQL. You need it in
> Part 5.

Click **Next**.

**Step 7.** On **Windows Service**, leave both boxes ticked — *Configure MySQL
Server as a Windows Service* and *Start the MySQL Server at System Startup*. The
service is named **MySQL80**; remember that, Troubleshooting refers to it. Click
**Next**.

**Step 8.** Click **Execute**, wait for all the ticks, then **Finish** through
the remaining screens.

MySQL is now running, and starts again by itself every time you turn the
computer on. You never launch it manually.

**Step 9 — make the `mysql` command work in the terminal.** Windows does not
know where MySQL lives yet. Press **Start**, type `powershell`, **right-click**
*Windows PowerShell* and choose **Run as administrator**. Paste this single line
and press Enter:

```powershell
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\Program Files\MySQL\MySQL Server 8.0\bin", "Machine")
```

Nothing is printed — that is normal.

**Step 10.** Close that administrator window completely. Open a **new, ordinary**
PowerShell window (Start → `powershell` → Enter) and check:

```powershell
mysql --version
```

**What you should see:**

```
mysql  Ver 8.0.36 for Win64 on x86_64 (MySQL Community Server - GPL)
```

If instead you get *"mysql is not recognized"*, open `C:\Program Files\MySQL\` in
File Explorer and look at the folder name inside. If it says `MySQL Server 8.4`
or `MySQL Server 9.0`, redo step 9 using that exact name in place of
`MySQL Server 8.0`.

---

## 1a. Install MySQL — macOS

**Step 1.** Go to
[dev.mysql.com/downloads/mysql](https://dev.mysql.com/downloads/mysql/) and
download the **macOS DMG Archive**:

- **ARM, 64-bit** if you have an Apple Silicon Mac (M1/M2/M3/M4)
- **x86, 64-bit** if you have an older Intel Mac

Not sure which? Click the **Apple menu → About This Mac** and read the *Chip* or
*Processor* line. On the download page click **"No thanks, just start my
download"**.

**Step 2.** Open the downloaded `.dmg`, then double-click the `.pkg` inside it.

**Step 3.** Click **Continue** / **Agree** / **Install** through the installer,
entering your Mac login password when asked.

> If macOS refuses to open it ("cannot be opened because it is from an
> unidentified developer"), go to **System Settings → Privacy & Security**,
> scroll down, click **Open Anyway**, and run the `.pkg` again.

**Step 4.** Near the end, the installer shows a **Configure MySQL Server**
screen. Leave *Use Strong Password Encryption* selected, then type a **root
password** twice.

> ⚠️ **Write this password down now.** It is the master password for your
> database, there is no recovery, and you need it in Part 5.

**Step 5.** When the installer finishes, open **System Settings** and scroll to
the very bottom of the left sidebar — there is now a **MySQL** entry. Click it
and confirm the server says **running**. Tick **Start MySQL when your computer
starts up**.

**Step 6 — make the `mysql` command work in the terminal.** Open Terminal
(**Cmd + Space**, type `terminal`, press Enter) and paste these two lines, one
at a time:

```bash
echo 'export PATH="/usr/local/mysql/bin:$PATH"' >> ~/.zshrc
```

```bash
source ~/.zshrc
```

**Step 7.** Check it worked:

```bash
mysql --version
```

**What you should see:**

```
mysql  Ver 8.0.36 for macos14 on arm64 (MySQL Community Server - GPL)
```

<details>
<summary><b>Alternative:</b> install with Homebrew instead of the installer</summary>

If you already use [Homebrew](https://brew.sh), this is quicker:

```bash
brew install mysql
```

```bash
brew services start mysql
```

Two differences from the installer route:

1. The `mysql` command already works — skip steps 6 and 7 above.
2. **The root account has no password at all.** Wherever this guide says
   `mysql -u root -p`, use `mysql -u root` (without `-p`) instead.

</details>

---

## 1a. Install MySQL — Ubuntu / Linux

**Step 1.** Open a terminal with **Ctrl + Alt + T**.

**Step 2.** Refresh the list of available software:

```bash
sudo apt update
```

`sudo` means "do this as administrator" and asks for **your computer's login
password**. **Nothing appears on screen while you type it** — no dots, no stars.
That is normal, not a bug. Type it and press Enter.

**Step 3.** Install the database server:

```bash
sudo apt install -y mysql-server
```

This prints a lot of text and takes a minute or two.

**Step 4.** Start it, and make it start automatically after every reboot:

```bash
sudo systemctl enable --now mysql
```

**Step 5.** Check that it really is running:

```bash
sudo systemctl status mysql
```

**What you should see** — the words **active (running)**:

```
● mysql.service - MySQL Community Server
     Loaded: loaded (/lib/systemd/system/mysql.service; enabled; ...)
     Active: active (running) since Thu 2026-08-14 10:12:03 IST; 5s ago
```

Press **q** to return to the prompt.

**Step 6.** Confirm the client program is available:

```bash
mysql --version
```

> **Important Ubuntu quirk — read this before Part 5.** On Ubuntu the MySQL
> `root` account has **no password** and can only be used through `sudo`. So
> `mysql -u root -p` fails with *Access denied* no matter what you type — that
> is expected, not a broken install. Part 5 uses `sudo mysql` instead, and then
> creates a normal password account for the dashboard to use.

---

## 1b. Install Node.js — Windows

**Step 1.** Go to [nodejs.org](https://nodejs.org) and click the big green
**LTS** button. Any version numbered **20 or higher** is fine.

**Step 2.** Run the downloaded installer and click **Next** through every
screen, accepting all defaults. Do not untick anything.

**Step 3.** **Restart your computer.** (Closing every terminal window is enough
in theory, but a restart avoids the most common "node is not recognized"
problem.)

**Step 4.** Open a new PowerShell window and check both commands:

```powershell
node -v
```

```powershell
npm -v
```

**What you should see** — a version starting with `v20` or higher, then a second
number:

```
v20.11.1
10.5.0
```

---

## 1b. Install Node.js — macOS

**Step 1.** Go to [nodejs.org](https://nodejs.org) and click the green **LTS**
button to download the `.pkg`.

**Step 2.** Open it and click **Continue** / **Install** through to the end,
entering your Mac password when asked.

**Step 3.** Open a **new** Terminal window and check:

```bash
node -v
```

```bash
npm -v
```

**What you should see:**

```
v20.11.1
10.5.0
```

---

## 1b. Install Node.js — Ubuntu / Linux

The version in Ubuntu's own software list is usually too old for this project,
so add NodeSource's list first.

**Step 1.**

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
```

**Step 2.**

```bash
sudo apt install -y nodejs
```

**Step 3.** Check both:

```bash
node -v
```

```bash
npm -v
```

**What you should see:**

```
v20.11.1
10.5.0
```

If `node -v` prints something lower than `v20`, an older Node is also installed.
Remove it with `sudo apt remove nodejs` and repeat steps 1–2.

---

# Part 2 — How to open a terminal

Everything from here is typed into a terminal — a plain window where you type
commands instead of clicking.

| System | How to open it |
|---|---|
| **Windows** | Press **Start**, type `powershell`, press **Enter** |
| **macOS** | Press **Cmd + Space**, type `terminal`, press **Enter** |
| **Ubuntu** | Press **Ctrl + Alt + T** |

Four things worth knowing before you start:

1. **One command at a time.** Paste it, press **Enter**, and wait for the
   blinking cursor to come back before pasting the next. Some commands take
   minutes and print nothing while they work.
2. **Pasting.** Windows PowerShell and macOS Terminal use the normal paste
   shortcut. The Ubuntu terminal uses **Ctrl + Shift + V**, not Ctrl + V.
3. **`cd` means "go into this folder".** It is how you tell the terminal which
   project you are working on.
4. **Nothing here can break your computer.** If you get lost, close the window
   and open a new one.

---

# Part 3 — Download the project

**Step 1.** On the project's GitHub page, click the green **Code** button, then
**Download ZIP**.

**Step 2.** Unzip it somewhere you will find again, keeping the path simple — no
spaces, no accented characters:

- **Windows**: `C:\projects\shopify-dashboard`
- **macOS / Ubuntu**: your home folder, e.g. `~/shopify-dashboard`

**Step 3.** Point the terminal at that folder — use *your* path:

```powershell
# Windows
cd C:\projects\shopify-dashboard
```

```bash
# macOS / Ubuntu
cd ~/shopify-dashboard
```

> **Tip (Windows):** instead of typing the path, type `cd ` (with a space after
> it) and drag the folder from File Explorer onto the terminal window — it fills
> the path in for you.

**Step 4.** Confirm you are in the right place by listing the files:

```powershell
# Windows
dir
```

```bash
# macOS / Ubuntu
ls
```

**What you should see** — among other things, a file called **`package.json`**
and folders called **`app`** and **`prisma`**. If `package.json` is not there,
you are in the wrong folder — most likely one level too high, in the folder that
*contains* the project folder. `cd` into it and list again.

> ⚠️ **Every command in Parts 4 to 9 must be run from inside this folder.** If
> you close the terminal, `cd` back here before continuing.

<details>
<summary>Prefer to use Git?</summary>

If you have Git installed, this does the same thing and makes future updates a
one-line `git pull`:

```bash
git clone <this-repo-url> shopify-dashboard
```

```bash
cd shopify-dashboard
```

</details>

---

# Part 4 — Install the project's dependencies

**Step 1.** From inside the project folder:

```bash
npm install
```

**What happens:** it downloads the few hundred small packages the dashboard is
built from. **This takes 2–5 minutes** and prints a lot of scrolling text. Lines
containing `warn`, `deprecated` or `funding` are normal and can be ignored — the
only word that matters is `error`.

This step also runs `prisma generate` automatically, which builds the code that
lets the app talk to your database.

**What you should see** at the end:

```
added 412 packages, and audited 413 packages in 1m

found 0 vulnerabilities
```

The cursor comes back and you can type again. (A "found N vulnerabilities"
notice is not a failure — carry on.)

---

# Part 5 — Create the database

This part creates **one empty database** and **one user account** for the
dashboard to log in with.

You are *not* creating any tables here — **Prisma builds all of those for you in
Part 7**. Right now you are only making the empty container they go into.

---

## 5a. Open the MySQL prompt

Use the block for your system.

### Windows

```powershell
mysql -u root -p
```

It then asks:

```
Enter password:
```

Type the **root password you set in Part 1a, step 6**. **Nothing appears as you
type** — no dots, no stars. Type it and press Enter.

If you get *"mysql is not recognized"*, close the terminal and open a brand-new
one (the PATH change from Part 1a only applies to new windows). If it still
fails, use the full path:

```powershell
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p
```

### macOS

```bash
mysql -u root -p
```

Type the **root password you set during the installer**. Nothing appears as you
type — that is normal.

If you installed with Homebrew there is no password, so use this instead:

```bash
mysql -u root
```

### Ubuntu / Linux

```bash
sudo mysql
```

This asks for **your computer's login password**, not a database one.

> Do **not** use `mysql -u root -p` on Ubuntu. It fails with
> `ERROR 1698 (28000): Access denied for user 'root'@'localhost'` whatever you
> type, because the packaged root account is tied to `sudo` instead of a
> password. That is normal Ubuntu behaviour.

### What you should see

```
Welcome to the MySQL monitor.  Commands end with ; or \g.
Your MySQL connection id is 8
Server version: 8.0.36 MySQL Community Server - GPL

mysql>
```

**The prompt has changed to `mysql>`.** You are now typing commands *into the
database*, not into your operating system — ordinary terminal commands will not
work again until you leave with `EXIT;` at the end of 5b.

---

## 5b. Create the database and its user

**Before pasting anything, choose a password.** In command 2 below, replace
`ChangeThisPassword123` with a password of your own.

> Use **letters and numbers only — no symbols.** Characters like `@ / : # ?` have
> a special meaning inside the connection address you write in Part 6 and will
> silently break it. **Write this password down**; you need it twice more.

Now paste these **one at a time**, pressing **Enter** after each.

> ⚠️ **The semicolon at the end of each line is required.** Forget it and MySQL
> shows `->` and appears to hang — it is just waiting for the rest of your
> command. Type `;` and press Enter to unstick it.

**Command 1 — create the empty database:**

```sql
CREATE DATABASE shopify_dashboard CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

```
Query OK, 1 row affected (0.01 sec)
```

**Command 2 — create the login the dashboard will use** (change the password
first):

```sql
CREATE USER 'shopify_user'@'localhost' IDENTIFIED BY 'ChangeThisPassword123';
```

```
Query OK, 0 rows affected (0.02 sec)
```

**Command 3 — give that login full control of that one database:**

```sql
GRANT ALL PRIVILEGES ON shopify_dashboard.* TO 'shopify_user'@'localhost';
```

```
Query OK, 0 rows affected (0.01 sec)
```

**Command 4 — apply the permission change:**

```sql
FLUSH PRIVILEGES;
```

```
Query OK, 0 rows affected (0.00 sec)
```

**Command 5 — check the database is there:**

```sql
SHOW DATABASES;
```

**What you should see** — `shopify_dashboard` in the list, alongside MySQL's own
databases:

```
+--------------------+
| Database           |
+--------------------+
| information_schema |
| mysql              |
| performance_schema |
| shopify_dashboard  |
| sys                |
+--------------------+
5 rows in set (0.00 sec)
```

**Command 6 — leave MySQL:**

```sql
EXIT;
```

The prompt goes back to your normal terminal.

### What those commands actually did

| Command | In plain English |
|---|---|
| `CREATE DATABASE` | Made an empty database named `shopify_dashboard` |
| `CREATE USER` | Made a login called `shopify_user` for the app to use |
| `GRANT ALL PRIVILEGES ON shopify_dashboard.*` | Gave that login full control of **that one database only** — it cannot touch anything else on your computer |
| `FLUSH PRIVILEGES` | Saved the permission change immediately |

> **Why not just let the app use `root`?** If the dashboard is ever compromised,
> a limited account can only damage one database, while `root` can drop every
> database on the machine. It also means your master password never goes into a
> file.

> **Why `utf8mb4` matters.** Shopify store names and merchant emails contain
> emoji and non-Latin alphabets. MySQL's older `utf8` cannot store them, and
> saving fails part-way through, leaving broken rows. It is not optional here.
> If you created the database without it, run
> `DROP DATABASE shopify_dashboard;` and repeat command 1 exactly as written.

---

## 5c. Test the new account before going further

You are back at your normal terminal (the prompt is **not** `mysql>`). Run:

```bash
mysql -u shopify_user -p shopify_dashboard -e "SELECT DATABASE();"
```

Enter the password you chose in command 2.

**What you should see:**

```
+-------------------+
| DATABASE()        |
+-------------------+
| shopify_dashboard |
+-------------------+
```

**This is the exact login the dashboard itself will use in Part 7**, so proving
it works now saves you from debugging a failure later.

If you get `ERROR 1045 (28000): Access denied for user 'shopify_user'@'localhost'`,
the password does not match. Go back into MySQL (5a) and reset it:

```sql
ALTER USER 'shopify_user'@'localhost' IDENTIFIED BY 'ANewSimplePassword123';
```

```sql
FLUSH PRIVILEGES;
```

```sql
EXIT;
```

Then run the 5c test again with the new password.

---

# Part 6 — Create your settings file

The dashboard reads its settings from a file called **`.env`** in the project
folder. A template with every option documented is already there —
`.env.example` — so you copy it and fill in **four** values.

---

## 6a. Copy the template

From inside the project folder:

```powershell
# Windows (PowerShell)
Copy-Item .env.example .env
```

```bash
# macOS / Ubuntu
cp .env.example .env
```

Nothing is printed. The leading dot in `.env` is part of the name and matters.

---

## 6b. Open it in a text editor

```powershell
# Windows
notepad .env
```

```bash
# macOS
open -e .env
```

```bash
# Ubuntu
nano .env
```

> **Using `nano`?** Save with **Ctrl + O** then **Enter**; exit with
> **Ctrl + X**. The `^` symbols along the bottom of the screen mean Ctrl.

The file is mostly explanatory comments — lines starting with `#`, which the app
ignores completely. **Leave all of them alone.** You are changing four lines,
and each already exists in the file; you are filling in what comes after the `=`.

---

## 6c. Value 1 of 4 — `DATABASE_URL`

This one line tells the app how to reach the database you made in Part 5. Find
the line starting `DATABASE_URL=` and make it read:

```
DATABASE_URL=mysql://shopify_user:ChangeThisPassword123@localhost:3306/shopify_dashboard
```

Replace `ChangeThisPassword123` with the password you chose in Part 5b,
command 2. Read the line like this:

```
mysql://shopify_user:ChangeThisPassword123@localhost:3306/shopify_dashboard
        └── user ──┘ └──── password ────┘ └ this PC ┘└port┘ └── database ──┘
```

Common mistakes: leaving the template's `user:password` in place; putting a
space anywhere in the line; wrapping the value in quotation marks (do not add
any).

> **If your password contains a symbol**, it must be percent-encoded or the
> address is read wrongly: `@` → `%40`, `/` → `%2F`, `:` → `%3A`, `#` → `%23`,
> `?` → `%3F`. Far simpler: go back to 5c and reset the password to letters and
> numbers only.

---

## 6d. Value 2 of 4 — `SESSION_SECRET`

A long random string that signs your login cookie, so nobody can forge a
session. Generate one — open a second terminal, or come back to this after
saving the file:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**What you should see** — a 64-character line like:

```
9f2a1c4e7b8d3a06f5e1c2b9d4a7803e6f1b5c9a2d8e4f7061a3c5b8d2e9f406
```

Copy it and paste it after the `=`:

```
SESSION_SECRET=9f2a1c4e7b8d3a06f5e1c2b9d4a7803e6f1b5c9a2d8e4f7061a3c5b8d2e9f406
```

Use your own generated value, not the example above. Changing this value later
logs everyone out — harmless, but they must sign in again.

---

## 6e. Value 3 of 4 — `DASHBOARD_PASSWORD`

A second random string. This is **not** your login password — it is the key the
app's own background jobs and any scripts use when they call it. Generate it the
same way:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

Then paste it in:

```
DASHBOARD_PASSWORD=paste-the-random-string-here
```

---

## 6f. Value 4 of 4 — `DASHBOARD_BASE_URL`

The web address you will open the dashboard at. Running on your own computer,
**leave it exactly as the template has it**:

```
DASHBOARD_BASE_URL=http://localhost:3000
```

(It is used to build the unsubscribe and tracking links inside outgoing email,
which is why it has to be an address people can actually reach.)

**Now save the file and close the editor.** That is every required setting.

> **Nothing about email goes in this file.** Which provider sends your mail,
> which address it comes from, and who receives internal alerts are all
> configured inside the dashboard after you log in — see
> [Set up email](#set-up-email).

> ⚠️ **Never share your `.env` file, email it, or upload it anywhere.** It holds
> your database password and your session key. It is already excluded from Git
> so it cannot be committed by accident.

---

# Part 7 — Let Prisma create the tables

Your database exists but has nothing in it. This is the step where the tables the
dashboard needs get built — you write no SQL, Prisma has the full definition and
applies it.

**Step 1.** From inside the project folder:

```bash
npx prisma migrate deploy
```

**What you should see:**

```
Prisma schema loaded from prisma/schema.prisma
Datasource "db": MySQL database "shopify_dashboard" at "localhost:3306"

30 migrations found in prisma/migrations

Applying migration `20260506095212_init`
Applying migration `20260508134417_add_file_blob`
Applying migration `20260625000000_add_shopify_partner`
... one line per migration ...
Applying migration `20260814000000_add_users_and_partner_managed_stores`

All migrations have been successfully applied.
```

It applies them in date order and prints one line each, so the list is long and
scrolls past — that is normal. The only line that matters is the last one.

> If this fails with `P1001: Can't reach database server` or *Access denied*,
> the problem is in `DATABASE_URL` — the Part 5c test already proved the login
> itself works, so compare that line character by character with 6c.

> If it fails with **`P3018`** partway through, see the entry for it in
> [Troubleshooting](#p3018-a-migration-failed-to-apply) — you will need to empty
> the database before retrying, because the migrations that already ran are not
> rolled back.

**Step 2.** Confirm the database now matches what the code expects:

```bash
npx prisma migrate status
```

**What you should see:**

```
Database schema is up to date!
```

**Step 3 (optional) — look at what was created.** This opens a browser window
where you can click through every table and its contents:

```bash
npx prisma studio
```

It keeps running and holds the terminal. Press **Ctrl + C** to close it and get
your prompt back.

> ⚠️ **Never create or alter tables by hand.** The files in `prisma/migrations`
> are the record of what has been applied. If you build tables yourself, the next
> update tries to create them again, fails, and you are left repairing it
> manually.

<details>
<summary>Fallback: if <code>migrate deploy</code> cannot run at all</summary>

`prisma/schema.sql` holds the same tables as one plain SQL script:

```bash
# macOS / Ubuntu
mysql -u shopify_user -p shopify_dashboard < prisma/schema.sql
```

```powershell
# Windows PowerShell — the < redirect does not exist here, use this instead
Get-Content prisma/schema.sql | mysql -u shopify_user -p shopify_dashboard
```

Loading it this way leaves Prisma's own bookkeeping table empty, so the next
update would try to create everything a second time. **Record the history
immediately afterwards:**

```bash
# macOS / Ubuntu
for d in prisma/migrations/*/; do npx prisma migrate resolve --applied "$(basename "$d")"; done
```

```powershell
# Windows
Get-ChildItem prisma/migrations -Directory | ForEach-Object { npx prisma migrate resolve --applied $_.Name }
```

Then confirm with `npx prisma migrate status`, which must say *Database schema
is up to date!*. Use `migrate deploy` whenever it works — this path exists only
for locked-down servers.

</details>

---

# Part 8 — Create your login

**There is no sign-up page**, deliberately — otherwise anyone who found your URL
could create an account. The first account is made from the terminal, and nobody
can sign in until you do this.

**Step 1.** Replace the email, password and name with your own, keeping the
quotation marks exactly where they are:

```bash
npx tsx scripts/set-password.ts you@example.com "your-password" --name "Your Name" --role admin
```

**What you should see:**

```
Updated password for you@example.com
```

**Step 2.** Write down the email and password you just used — that is your login
to the dashboard.

Your password is hashed before it is stored, so it never sits in the database in
readable form. **Run the same command again at any time** with a new password to
reset it.

---

# Part 9 — Start the dashboard

**Step 1.** From inside the project folder:

```bash
npm run dev
```

**What you should see** after a few seconds:

```
  ▲ Next.js 16.0.0
  - Local:        http://localhost:3000

 ✓ Ready in 2.3s
```

**Step 2.** Open a web browser and go to:

```
http://localhost:3000
```

**Step 3.** Sign in with the email and password from Part 8.

**You are done.** The dashboard is empty until you connect a Partner account —
see [After first login](#after-first-login).

### Stopping and starting it again

- **To stop it:** click the terminal window and press **Ctrl + C**.
- **After a reboot:** MySQL restarts by itself, so there are only three steps —
  open a terminal, `cd` into the project folder, run `npm run dev`, then open
  `http://localhost:3000`.
- **While it runs, that terminal is busy** showing the app's log. Open a second
  terminal window if you need to run anything else.

<details>
<summary>Running it properly (production mode)</summary>

`npm run dev` is development mode — slower, and it deliberately skips the
background jobs. For a real installation:

```bash
npm run build
```

```bash
npm start
```

`npm start` honours the `PORT` setting from `.env` and defaults to 3000.

**Background jobs.** In production mode the server schedules its own work —
polling the Partner API for new installs and uninstalls every 5 minutes, plus
slower housekeeping — so no external cron daemon is needed. These are skipped
under `npm run dev` because they call the live Partner API and send real email.
To run them in development anyway, set `ENABLE_CRON=true` in `.env` — and either
leave email unconfigured, or set `EMAIL_REDIRECT_TO` to your own address, so no
merchant is ever mailed from your laptop. If you run more than one copy of the
app, set `ENABLE_CRON=false` on all but one, or every job runs twice.

</details>

---

# After first login

## Connect your Shopify Partner account

Everything from here is configured by clicking around the dashboard — nothing
else goes into `.env`.

**Step 1.** Go to [partners.shopify.com](https://partners.shopify.com) →
**Settings** → **Partner API clients** → **Create Partner API client**. Give it a
name, save, and copy the **access token** it shows you.

**Step 2.** Find your **organization ID**. Look at your browser's address bar
while on the Partner site: `partners.shopify.com/1234567/...` — that number is
your organization ID.

**Step 3.** In the dashboard, go to **Shopify → Partners → Add partner**. Paste
the token and the organization ID, give it a name, and save.

**Step 4.** Click **Sync**. Your apps, installs and uninstalls import from
Shopify. The first import can take several minutes if you have a lot of history.

After that the dashboard refreshes itself every 5 minutes (in production mode);
**Sync** is only for forcing an immediate update.

Repeat for each Partner organization you own — one installation can track
several.

> Your Partner token is stored in your own database and is never sent back to
> your browser after you save it — the page redisplays it masked as `••••wxyz`.

## Set up email

Install alerts, flows, campaigns and sequences all send through one provider,
configured under **Settings → Email**. None of this is an environment variable —
it all lives in your database, so you set it up once in the browser.

**Step 1 — pick how mail is sent.**

- **Brevo** — paste an API key from Brevo's **SMTP & API → API Keys** page.
- **SMTP** — the host, port, username and password of any email account (Gmail,
  Zoho, Outlook, Postmark, your own server). Leave *implicit TLS* **off** for
  port 587 and **on** for port 465.

Both sets of credentials are stored side by side and the radio button decides
which one is live, so switching back after a test costs nothing. Either set can
be replaced, or removed with the **Remove** button (which asks for a second
click before it fires).

**Step 2 — test it.** **Test connection** checks the credentials without sending
anything. **Send test email** actually sends one — do this, because it is the
only way to catch a server that accepts your password but then refuses to send
*as* your chosen address.

**Step 3 — choose the from-address**, in the **From address** panel on the same
page. With Brevo it lists every sender registered on that account, so you pick
one from a dropdown. SMTP cannot list addresses, so it offers your SMTP username
— the one address that login is certain to be allowed to send as. Extra
addresses and aliases are added by hand under **Email → Senders**; an address
your provider has not verified is saved with a warning rather than refused,
because aliases and company relays are legitimate — but the provider may still
reject it at send time with a message like
`553 Sender is not allowed to relay`. If that happens, use an address your email
account genuinely owns.

The address marked **default** is used for *every* message the dashboard sends.
There is no setting in `.env` that can override it — what you pick here is what
goes out. To send certain flows or campaigns from a second address, add that
address too and select it on the flow or campaign itself.

**Step 4 — add your team's recipients**, the addresses that receive install and
uninstall notifications. Same page, and mirrored under **Email → Settings**.
Removing one asks for confirmation, and it warns you before deleting the last
one, since that quietly switches internal alerts off.

If you skip email entirely, the rest of the dashboard works fine — sends are
just skipped with an explanatory message.

> **While testing**, set `EMAIL_REDIRECT_TO` in `.env` to your own address: every
> outgoing message then goes to you instead of to real merchants, with the
> intended recipients moved into the subject line. **Leave it empty on a real
> installation** — with a value set, nobody receives their mail.

---

# Managing users

There is no self-service registration, by design. Add teammates exactly the way
you created your own account in Part 8:

```bash
npx tsx scripts/set-password.ts teammate@example.com "their-password" --name "Their Name" --role admin
```

Re-running it with a new password resets an existing account.

Every account is an admin. The login only accepts `role = 'admin'`, so passing
any other `--role` creates an account that exists but can never sign in.

---

# Troubleshooting

### `mysql` : command not found / is not recognized
MySQL is installed but the terminal does not know where it is.
**First:** close every terminal window and open a new one — a PATH change only
applies to windows opened afterwards.
**Windows:** open `C:\Program Files\MySQL\` and check the folder name matches the
one in the PATH command in Part 1a step 9 (it may be `MySQL Server 8.4`).
**macOS:** re-run the two `export PATH` lines from Part 1a step 6.

### `ERROR 1698 (28000): Access denied for user 'root'@'localhost'` (Ubuntu)
Expected, not a fault. Ubuntu's root database account has no password and is
reached through `sudo`. Use **`sudo mysql`** instead of `mysql -u root -p`.

### `ERROR 1396 (HY000): Operation CREATE USER failed for 'shopify_user'@'localhost'`
The user already exists — MySQL reports that as a generic failure instead of
saying so. It usually means you ran command 2 once before. Confirm it:
```sql
SELECT user, host FROM mysql.user WHERE user = 'shopify_user';
```
If a row comes back, skip `CREATE USER` and just set the password you want:
```sql
ALTER USER 'shopify_user'@'localhost' IDENTIFIED BY 'YourPassword123';
```
Then continue with commands 3 and 4. To start clean instead, run
`DROP USER 'shopify_user'@'localhost';` first and then `CREATE USER` again.

### `ERROR 1045 (28000): Access denied for user 'shopify_user'@'localhost'`
The password in your command (or in `DATABASE_URL`) does not match the one you
set. Get back into MySQL with 5a, then:
```sql
ALTER USER 'shopify_user'@'localhost' IDENTIFIED BY 'ANewSimplePassword123';
FLUSH PRIVILEGES;
EXIT;
```
Update `DATABASE_URL` in `.env` to match, and re-run the Part 5c test.

### `Can't connect to MySQL server on 'localhost'` / `ECONNREFUSED 127.0.0.1:3306`
MySQL is not running.
**Windows:** press Start, type `services.msc`, find **MySQL80**, right-click →
**Start**.
**macOS:** **System Settings → MySQL → Start MySQL Server**.
**Ubuntu:** `sudo systemctl start mysql`

### MySQL will not start, or port 3306 is already in use
Something else already owns that port — usually an older MySQL, or XAMPP / WAMP /
MAMP / a Docker container if you have ever installed one. Stop or uninstall that
program, then start MySQL again.

### `Unknown database 'shopify_dashboard'`
The `CREATE DATABASE` command did not run, or the name is spelled differently.
Open the MySQL prompt (5a) and run `SHOW DATABASES;`. The name in that list must
match the end of your `DATABASE_URL` **exactly**, underscores included.

### The `mysql>` prompt turned into `->` and nothing happens
You left the semicolon off the end of a command. Type `;` and press Enter.

### `P1001: Can't reach database server at localhost:3306` from Prisma
Same cause as the connection error above — MySQL is stopped, or the host/port in
`DATABASE_URL` is wrong. Start MySQL, verify with the Part 5c test, then re-run
`npx prisma migrate deploy`.

### `P3018: A migration failed to apply`
Prisma stops on the first migration that errors and, importantly, **does not undo
the ones that already succeeded** — so the database is now half-built and simply
re-running `migrate deploy` will not fix it. Two things to do, in this order.

**1. Do not edit the file it names.** The error prints the failing migration and
its SQL, which makes editing it tempting. Don't — those files are a shared
history, and a local change means your database no longer matches everyone
else's. (Commenting a line out with `--` usually makes it worse: MySQL only
treats `--` as a comment when a **space** follows it, so `--ALTER TABLE` is not
a comment, it is a syntax error, and you get `1064` on top of the original
problem.) If you have already edited one, put it back:

```bash
git checkout -- prisma/migrations
```

**2. Start the database over.** Nothing in it is worth keeping at this stage —
you have not logged in yet. Open the MySQL prompt (5a) and run:

```sql
DROP DATABASE shopify_dashboard;
CREATE DATABASE shopify_dashboard CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
EXIT;
```

Then `git pull` to be sure you are on the current migrations, and run
`npx prisma migrate deploy` again.

If it fails at the same migration on a genuinely empty database, that is a bug in
this repository rather than anything you did — open an issue with the full error,
including the migration name and the database error code.

### `node` / `npm` : command not found
Node.js is not installed, or the terminal was already open when you installed it.
Close every terminal, open a new one, and try `node -v` again. On Windows,
restart the computer if it still fails.

### `npm install` fails with permission errors
On macOS/Ubuntu do **not** re-run it with `sudo` — that creates root-owned files
you will fight with later. Make sure the project sits in a folder you own, such
as your home folder, not a system folder like `/opt` or `C:\Program Files`.

### `Port 3000 is already in use`
Another program has it. Close that program, or add `PORT=3001` to `.env`, run
`npm run dev` again and open `http://localhost:3001`.

### Store names or emoji save as `???`
The database was created without `utf8mb4`. Open the MySQL prompt, run
`DROP DATABASE shopify_dashboard;`, redo Part 5b command 1 exactly as written,
then re-run Part 7.

### I forgot my dashboard password
Run the Part 8 command again with the same email and a new password.

### It worked yesterday and now the page will not load
Check three things in order: is MySQL running (see the connection error above);
are you inside the project folder; is `npm run dev` actually running in a
terminal. The dashboard is not a background service — closing that terminal
stops it.

---

# Environment variables

See [`.env.example`](.env.example) — every setting is listed there with a
description of what it does and whether it is required. Only four are required,
and Part 6 walks through all four.

Two rules worth repeating:

- **Never put a secret in a `NEXT_PUBLIC_*` variable.** Anything with that prefix
  is copied into the code your browser downloads, where any visitor can read it.
- **`.env` is excluded from Git and must stay that way.** It holds your database
  password and your session key.

Shopify Partner tokens, the email provider and its credentials, sender addresses,
alert recipients and per-app API endpoints are **not** environment variables —
they live in the database and are managed from the UI, because they are lists
that grow and change without reinstalling anything.

---

# Deployment

Everything above describes running the dashboard on your own computer. On a
server the database steps are identical — install MySQL, run the Part 5 SQL,
point `DATABASE_URL` at it, run `npx prisma migrate deploy`.

`scripts/deploy.sh` is a reference deploy for a pm2 + nginx box. It pulls the
branch, installs, runs `prisma migrate deploy` **before** the build (so a page
never goes live ahead of the database columns it needs), builds, and reloads pm2.
Override the paths with environment variables:

```bash
APP_DIR=/var/www/shopify-dashboard APP_PORT=3011 bash scripts/deploy.sh
```

On a server, also:

- Set `DASHBOARD_BASE_URL` to the real public address and `TZ_DISPLAY` to your
  timezone (e.g. `Asia/Kolkata`). Both are read at build time, so set them
  **before** running `npm run build`.
- Set `PARTNER_WEBHOOK_SECRET` and `BREVO_WEBHOOK_SECRET`. While they are empty,
  those two webhook endpoints accept any request.
- Make sure `EMAIL_REDIRECT_TO` is **empty**, or nobody receives their mail.
- Create your login with the Part 8 command, run from the app directory so it
  picks up the server's own `.env`.
- Configure email again under **Settings → Email** — those settings live in that
  installation's database, so they do not travel with the code.

---

## Tech stack

Next.js 16 (App Router) · Prisma + MySQL · Tailwind CSS · Brevo or SMTP for email

## License

MIT — see [LICENSE](LICENSE).
