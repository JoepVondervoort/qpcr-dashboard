# Installing the qPCR Analysis Workbench

These instructions assume no programming experience.

The workbench runs **on your own computer** and opens in your web browser. It is not a
website: there is no account, and your qPCR files and results stay on your computer.

The setup takes about **ten minutes** and needs an internet connection. You also need a GitHub
account that has been given access to this repository.

---

## Before you start

| | Needed? |
|---|---|
| Python, Node.js, Git | **No.** The setup downloads the right Python by itself. |
| Administrator rights | **No.** Everything installs under your own user account. |
| WSL, Docker, Anaconda | **No.** |
| A GitHub account **with access to this repository** | **Yes.** You download the installation file from GitHub. |

> **If you use WSL for something else:** do not install the workbench inside WSL. Install
> it on Windows itself, in PowerShell, as described below.

---

## Windows

### Step 1: Open PowerShell

Press the **Windows key**, type `powershell`, and press **Enter**. A window with a blinking
cursor opens.

For each step, copy the **whole command** from the grey box. Right-click in PowerShell to
paste it, then press **Enter**. Wait for the `PS ...>` prompt to return before you run the next
command. If you see `>>`, press **Ctrl+C** and paste the complete command again.

### Step 2: Install `uv` (only once)

`uv` is a small program that installs the workbench and its own private Python. **If you
already installed saRNA Designer, you already have it: skip to step 3.**

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

If your organisation blocks that command, `winget install --id=astral-sh.uv -e` does the same
thing.

**Then close PowerShell completely and open it again.** A new window is needed to see `uv`.

### Step 3: Download the installation file

1. Open <https://github.com/JoepVondervoort/qpcr-dashboard/releases/latest> in your browser,
   and sign in to GitHub if you are asked to.
2. Under **Assets**, click the file that ends in `.whl`, for example
   `qpcr_workbench-0.1.0-py3-none-any.whl`. It is saved in your **Downloads** folder.

Do not open or unzip the file. If GitHub shows **404 / Page not found**, you are either not
signed in or your account has not been given access yet.

### Step 4: Install it

```powershell
uv tool install --python 3.11 "$env:USERPROFILE\Downloads\qpcr_workbench-0.1.0-py3-none-any.whl"
```

If the file you downloaded has a different number than `0.1.0`, change the number in the
command to match. `$env:USERPROFILE` means your own Windows user folder; leave it exactly as
written.

The first installation can take a few minutes. It is finished when you see:

```
Installed 1 executable: qpcr-workbench
```

If you do not see that line, stop and see [If something goes wrong](#if-something-goes-wrong).

### Step 5: Close PowerShell and open it again

Do this even if you saw no warning. If step 4 warned that a folder *"is not on your PATH"*,
first run this command, and then close and reopen PowerShell:

```powershell
uv tool update-shell
```

### Step 6: Start the workbench

```powershell
qpcr-workbench
```

Your browser opens the workbench at `http://127.0.0.1:8002/`. If it does not, copy that
address into your browser yourself.

**Leave the PowerShell window open while you work**, because closing it stops the workbench.
To stop it on purpose, click the PowerShell window and press **Ctrl+C**.

From now on, you only need step 1 and step 6 to use it.

---

## macOS

1. Open **Terminal**: press **Cmd+Space**, type `terminal`, and press **Enter**.
2. Install `uv` (skip this if you already have it), then close Terminal and open it again:
   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```
3. Download the `.whl` file as in [Windows step 3](#step-3-download-the-installation-file).
4. Install it, changing `0.1.0` if your file has another number:
   ```bash
   uv tool install --python 3.11 ~/Downloads/qpcr_workbench-0.1.0-py3-none-any.whl
   ```
5. Close Terminal, open it again, and start the workbench:
   ```bash
   qpcr-workbench
   ```

---

## Where your data is kept

Everything you import and calculate is stored in one folder:

- Windows: `C:\Users\<your name>\.qpcr-workbench`
- macOS: `~/.qpcr-workbench`

Inside are `data\qpcr.db` (your projects, settings and saved analyses) and `uploads\` (an
unchanged copy of every file you imported). Updating, reinstalling and uninstalling the
workbench do not touch this folder.

**To make a backup**, stop the workbench (**Ctrl+C**) and then copy the whole `.qpcr-workbench`
folder somewhere safe, such as a network drive. If you copy it while the workbench is running,
the copy of the database can be incomplete.

The workbench only accepts connections from your own computer (`127.0.0.1`). Other computers
on the network cannot reach it.

---

## Updating to a newer version

1. Download the new `.whl` file from the
   [releases page](https://github.com/JoepVondervoort/qpcr-dashboard/releases/latest), as in
   step 3.
2. Stop the workbench if it is running (**Ctrl+C** in its PowerShell window).
3. Run the step 4 command again, **with the new file name**. Installing over the old version
   replaces it, so you do not need to uninstall first.
4. Check the version:
   ```powershell
   qpcr-workbench --version
   ```

> **`uv tool upgrade` does not work for this installation.** It prints `Nothing to upgrade`
> even when a newer version exists. Always install the new file instead.

Delete the old `.whl` from Downloads once the new version works. If two versions are in the
same folder, it is easy to install the old one by accident.

Your experiments and saved analyses are kept when you update.

---

## If something goes wrong

**`uv` is not recognised.** You did not close and reopen PowerShell after step 2.

**`qpcr-workbench` is not recognised.** Do step 5: close PowerShell and open a new window. If
that does not help, run `uv tool update-shell`, then open another new window. If it still fails,
step 4 did not finish. Run it again and read the last lines of the output.

**The install says the file does not exist.** Check the exact file name in your Downloads
folder. Windows sometimes adds `(1)` when you download a file twice. This command must print
`True`:

```powershell
Test-Path -LiteralPath "$env:USERPROFILE\Downloads\qpcr_workbench-0.1.0-py3-none-any.whl" -PathType Leaf
```

**`Port 8002 is already used by another program`.** Start the workbench on another port:
`qpcr-workbench --port 8003`.

**`qPCR Analysis Workbench is already running`.** The workbench is already open in another
PowerShell window. Your browser opens it again for you.

**The browser says it cannot connect.** Check that the PowerShell window is still open and
shows no error, then reload the page.

**Windows asks about the firewall.** You can choose **Cancel**. The workbench only listens on
your own computer.

**Anything else.** Run `qpcr-workbench --version`, then copy that and the full PowerShell output
and send them to the maintainer, or open an issue on the GitHub repository.

---

## Uninstalling

```powershell
uv tool uninstall qpcr-workbench
```

This removes the program. Your data stays in the `.qpcr-workbench` folder. Delete that
folder as well if you want your data gone. `uv` and the Python it downloaded stay installed,
because other tools such as saRNA Designer can use them.
