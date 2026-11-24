# E-Paper Desk: the 2 am guide

Read this on your phone. Do the steps in order. Stop when the lights are green.
Nothing here deletes your articles, photos or editions. Every button that changes data takes a safety copy first.

## 1. Open the desk

1. Open the ops address in your phone browser (the one that starts with `ops.`).
2. Type your password. Then type the 6-digit code from your authenticator app. If the phone is lost, use one of your 8 backup codes (each works once).
3. Five wrong tries lock the login for 15 minutes. Wait, then try again.
4. The desk works even when the website, the editor and the database are all down. That is what it is for.

## 2. What the lights mean

Each row is one part of the system. The colour is on the left.

- **Working (green):** leave it alone.
- **Check soon (amber):** it still works. Look at it in the morning.
- **Needs you (red):** do step 3 now. The row says in plain words what is wrong and what to press.

The rows, and what they are:

| Row | What it is |
|---|---|
| The API | the part the editor and admin talk to |
| The worker | makes pages, PDFs and e-paper editions |
| The database | where every article and edition is stored |
| The front door | the web address people open |
| The reader site | the e-paper reader (needs the front door) |
| The backup program | copies everything off the server |
| Backups, Last backup, Last restore check | proof that the copies exist and work |
| Disk space | red at 90 percent full |
| Memory | red when almost none is free |
| Jobs waiting, Failed jobs | the work line; amber is usually fine |
| Security certificate | the padlock; red means the website name is not set up |

## 3. Which button fixes what

Start at the top of the page. Red rows come first.

1. **One row is red:** press **Fix it (restart)** on that row. Wait. It says "healthy" when it is back (usually under 30 seconds, the database up to a minute). Pressing twice is safe.
2. **Many rows are red:** press **Bring everything up** (top of the page). It starts what is stopped, in the right order, and leaves what is running alone.
3. **Still red after Fix it:** press **Look at the log** on that row. It shows the last lines the program wrote. Passwords are hidden. Send those lines to the person who built it (step 7).
4. **Failed jobs is amber:** press **Retry failed jobs**.
5. **Memory is red:** press **Restart everything (in order)**. A big job may have used it all.
6. **Disk space is red or amber:** press **Free disk space**. The page lists what it will remove first (old exports, caches, temporary copies). Type `CLEAR` and press. It never touches originals or backups.
7. **Last backup is red:** press **Back up now**. If it fails, the backup bucket or its keys have a problem: tell the person who built it (step 7).
8. **Last restore check is red:** press **Check backups now**. It rebuilds a scratch copy of the database and looks inside. It takes a minute or two.
9. **A new release broke the site:** under **Earlier releases** press **Go back to this** on the last good one. Type `ROLLBACK`. It takes about 15 seconds. Your data is not touched.

## 4. Go back in time (a table or rows were deleted)

1. Under **Go back in time**, pick the minute just before it went wrong.
2. Press **Build the copy**. Type `RESTORE`. This builds a second database beside the live one. The live one is not changed.
3. Read the numbers side by side (live against the copy). If the copy has the rows you are missing, go on. If not, pick an earlier minute.
4. Press **Switch to the copy**. Type `SWITCH`. The desk takes a safety copy, makes the copy live and restarts the API and worker.
5. The old database is kept on disk. Anything written after the minute you chose is still in it. Ask for it to be read if you need those rows.

Files are never overwritten. **Files** on the same panel brings back files that are missing.

## 5. If the whole server is gone

You need a new server and your **recovery kit**. Then run `scripts/restore.sh` on the new server (this one step needs a terminal and someone who can use it). It rebuilds the database and files from the off-box copies. Plan for about an hour.

The recovery kit is kept by you, off the server, in your password manager. It holds:

1. The backup bucket details: web address, bucket name, key and secret.
2. The backup password. Without it the copies cannot be opened. Nobody can recover it for you.
3. The ops desk password and your 8 TOTP backup codes.
4. Your login for the domain name (DNS) and for the server provider.

If any of the four is missing, say so before you start. Do not guess.

## 6. If the desk itself does not open

1. Check your phone has internet. Try the address again in a private tab.
2. If the whole website is down too, the server may be off. Open the provider's console (from the recovery kit) and restart the server. Everything comes back by itself in a few minutes.
3. If only the desk is dead, restart it from the provider's console. The desk cannot press its own button while it is stopped.

## 7. What to tell the builder

Write down the time, the row that was red and the words under it. Copy them from **History** (it lists every press and the result). Do not paste passwords.

## The code is in the off-box backup too (since 2026-11-24)
Every push to the bucket also holds `/srv/epaper/desk` (the repository with its full git history; `node_modules` and `dist` are left out, they are rebuilt) and `/srv/epaper/demo-assets` (the Tamil demo photos, which git does not carry), and the safety dumps in `/srv/epaper/snapshots`.
On a brand-new machine that has Docker and the five `BACKUP_*` values, get the code back first, then run `scripts/restore.sh`:

    docker run --rm -e AWS_ACCESS_KEY_ID=<key id> -e AWS_SECRET_ACCESS_KEY=<key> -e RESTIC_PASSWORD=<backup password> \
      -v /srv/epaper:/target restic/restic:0.17.3 -r s3:<endpoint>/<bucket>/epaper/restic restore latest --tag auto --target /target/code-restore --include /data/desk --include /data/demo-assets
    mv /srv/epaper/code-restore/data/desk /srv/epaper/desk && mv /srv/epaper/code-restore/data/demo-assets /srv/epaper/demo-assets
    cd /srv/epaper/desk && git status      # the working tree and history are back

## "Free disk space" (what it may delete)
Old safety dumps (`/srv/epaper/snapshots/*.sql.gz`) and restored database copies (`/srv/epaper/restores/r*`) older than 7 days, plus rebuildable folders in the files folder. Rules, all enforced by `scripts/lib/desk-ops.sh desk_old_copies` (the desk lists first; you type CLEAR to delete):
- the 2 newest safety dumps are always kept;
- a dump is deleted only if the last push to the bucket (`push.snapshots_ok` in `backup-status.json`) is newer than the dump, so the bucket holds it;
- a restored database that is live, or ever was live (`/srv/epaper/files/_ops/was-live.txt`), is never deleted.
The screen lists what stays and why.

## The bucket says "daily usage cap" or "Access Denied"
The status line says which in plain words (Backblaze's own answer is read once per 10 minutes). The cap resets at 00:00 UTC; raise it in Backblaze > Caps & Alerts. The push waits 10 minutes between tries while the bucket refuses, and normally runs every `PUSH_INTERVAL` seconds (default 600; 60 needs raised caps, because a push every minute used up the free allowance by 03:00 UTC on 2026-11-24).
