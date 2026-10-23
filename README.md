# Pupper: step-by-step setup guide

Pupper is a chat app with a golden retriever puppy mascot. You get two things from this project:

- a **website** (it opens in any browser), and
- an **Android app** (an APK file you install on a phone).

Both use the same Firebase backend, so an account made on one works on the other. You do **not** need to install Node, Android Studio or any other program. You only need a web browser, and GitHub builds everything for you. Plan for about 45 to 60 minutes the first time.

> **Be honest with yourself about one thing:** this code was written without being able to compile or run it. Your first build may fail with a small error. That is normal. Part 10 shows how to get it fixed.

---

## Checklist

Tick these off in order.

- [ ] Part 1. Make a Google account and a GitHub account
- [ ] Part 2. Create the Firebase project (the backend)
- [ ] Part 3. Upload Pupper to GitHub
- [ ] Part 4. Give GitHub your Firebase values
- [ ] Part 5. Turn on GitHub Pages and build the website
- [ ] Part 6. Build the Android app (APK) and install it
- [ ] Part 7. Test with two accounts
- [ ] Part 8. Share Pupper with friends
- [ ] Part 9. Optional extras (GIF search, calls on every network, photo uploads from the website, cleanup of old statuses)
- [ ] Part 10. If something goes red

Words you will see:

- **Repository (repo):** your project's folder on GitHub.
- **Workflow:** a robot on GitHub that builds your website or APK.
- **Variable / Secret:** a setting you store in GitHub so the robot can use it.

---

## Part 1. Make the accounts

1. **Google account.** Use an existing Gmail. You need it for Firebase.
2. **GitHub account.** Go to https://github.com/signup and sign up (free).
3. Write down your GitHub **username**. Use it in lowercase everywhere below. This guide calls it `YOURUSERNAME`.

---

## Part 2. Create the Firebase project

Firebase menu names change now and then. If a label looks slightly different, pick the closest one.

### 2.1 Create the project

1. Go to https://console.firebase.google.com
2. Click **Create a project**.
3. Name it `pupper`.
4. You can turn Google Analytics **off**.
5. Click **Create project**, then **Continue**.

### 2.2 Turn on sign-in

1. In the left menu click **Build**, then **Authentication**.
2. Click **Get started**.
3. Click **Email/Password**.
4. Switch **Enable** on and click **Save**.

### 2.3 Create the database

1. Left menu: **Build**, then **Firestore Database**.
2. Click **Create database**.
3. Pick a location near your users (for India, `asia-south1 (Mumbai)`).
4. Choose **Start in production mode**.
5. Click **Enable** and wait until it finishes.

You do **not** need Firebase Storage. Photos and videos are uploaded to a free outside host instead (see Part 9).

### 2.4 Paste in the security rules (do not skip this)

The rules keep private chats private and make sure every Pupper number is unique.

1. Unzip `Pupper.zip` on your computer.
2. Open the file `firestore.rules` from the unzipped folder in any text editor (Notepad is fine).
3. Select all the text and copy it.
4. In Firebase go to **Firestore Database**, then the **Rules** tab.
5. Select everything in the box, delete it, and paste what you copied.
6. Click **Publish**.

### 2.5 Auto-delete old statuses

1. Still in **Firestore Database**, find **Time-to-live (TTL)**. It is under **Indexes** or on a tab of its own.
2. Click **Create policy**.
3. Collection group: `statuses`. Timestamp field: `expiresAt`.
4. Click **Create**.

### 2.6 Register the website app

1. Click the gear icon at the top left, then **Project settings**.
2. On the **General** tab scroll to **Your apps**.
3. Click the **`</>`** (Web) icon.
4. App nickname: `web`. Leave "Firebase Hosting" **unticked**. Click **Register app**.
5. You will see a block of code called `firebaseConfig`. **Keep this page open**, or copy it into a notepad. You need these five values:
   - `apiKey`
   - `authDomain`
   - `projectId`
   - `messagingSenderId`
   - `appId`
6. Click **Continue to console**.

### 2.7 Register the Android app

1. In **Project settings**, **General**, **Your apps**, click **Add app**, then the **Android** icon.
2. Android package name: **exactly** `com.pupper.app`
3. Click **Register app**.
4. Click **Next**, **Next**, **Continue to console**. Do **not** download anything.
5. Back in **Your apps**, click the Android app. Copy its **App ID**. It looks like `1:123456789:android:abcdef123456`. This is different from the web `appId`.

### 2.8 Allow your website to sign in

1. Go to **Authentication**, then **Settings**, then **Authorized domains**.
2. Click **Add domain**.
3. Type `YOURUSERNAME.github.io` (your username in lowercase, no `https://`, no `/pupper`).
4. Click **Add**.

---

## Part 3. Upload Pupper to GitHub

### 3.1 Create the repository

1. On GitHub click the **+** at the top right, then **New repository**.
2. Repository name: `pupper`.
3. Choose **Public**. Free GitHub Pages hosting needs a public repository.
4. Do **not** tick "Add a README".
5. Click **Create repository**.

**Your website address will be:** `https://YOURUSERNAME.github.io/pupper/`

> Want the shorter address `https://YOURUSERNAME.github.io/` with no `/pupper`? Name the repository exactly `YOURUSERNAME.github.io` instead. Everything else in this guide stays the same.

### 3.2 Upload the files

**Important:** upload what is *inside* the `Pupper` folder, not the `Pupper` folder itself.

1. Open the unzipped `Pupper` folder until you can see `README.md`, `android`, `web` and `firebase.json`.
2. Select **everything inside it**: press Ctrl+A on Windows, Cmd+A on Mac.
3. Choose one of these two ways to upload.

**Option A (easiest): GitHub Desktop**

1. Install GitHub Desktop from https://desktop.github.com and sign in.
2. Click **File**, then **Clone repository**, pick `pupper`, and clone it.
3. Copy everything from inside the `Pupper` folder into the cloned folder. Hidden folders come along automatically.
4. In GitHub Desktop type a summary like `first upload`, click **Commit to main**, then **Push origin**.

**Option B: browser only**

1. On your empty repository page click **uploading an existing file**.
2. Drag everything from inside the `Pupper` folder into the page.
3. Click **Commit changes**.
4. On Mac, first press Cmd+Shift+. in Finder so the hidden `.github` folder shows up. Windows shows it normally.

### 3.3 Check the upload

The top of your repository must show exactly these:

`.github`, `android`, `backend`, `functions`, `scripts`, `web`, `worker`, `README.md`, `firebase.json`, `firestore.indexes.json`, `firestore.rules`

- If you see a single folder called `Pupper` instead, delete the upload and redo it one level deeper.
- Open `.github`, then `workflows`. You must see `web.yml` and `android.yml`.
- If `.github` is missing, click **Add file**, then **Create new file**. Type `.github/workflows/web.yml` as the name, paste in the contents of that file from your unzipped folder, and click **Commit changes**. Repeat for `android.yml`.

---

## Part 4. Give GitHub your Firebase values

1. In your repository click **Settings**.
2. Click **Secrets and variables**, then **Actions**.
3. You will see two tabs: **Variables** and **Secrets**. For each row below click **New repository variable** (or **New repository secret**), type the name **exactly** as shown, paste the value, and save.

### Variables tab

| Name | Value |
|---|---|
| `VITE_FIREBASE_API_KEY` | `apiKey` from step 2.6 |
| `VITE_FIREBASE_AUTH_DOMAIN` | `authDomain` |
| `VITE_FIREBASE_PROJECT_ID` | `projectId` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `VITE_FIREBASE_APP_ID` | `appId` (the one containing `:web:`) |
| `FIREBASE_PROJECT_ID` | the same `projectId` |
| `DEPLOY_PAGES` | `true` |

### Secrets tab

| Name | Value |
|---|---|
| `FIREBASE_API_KEY` | the same `apiKey` |
| `FIREBASE_APP_ID` | the **Android** App ID from step 2.7 (it contains `:android:`) |

A misspelled name is the most common mistake. Check each one letter by letter.

---

## Part 5. Turn on GitHub Pages and build the website

1. In your repository click **Settings**, then **Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Leave **Custom domain** empty. The free `github.io` address is what you want.
4. Click the **Actions** tab.
5. If you see a green button saying "I understand my workflows, go ahead and enable them", click it.
6. In the list on the left click **Website**.
7. Click **Run workflow**, then **Run workflow** again.
8. Wait 3 to 5 minutes until you see a green tick.
9. Open `https://YOURUSERNAME.github.io/pupper/`.
10. Click **Create account** and sign up.

Notes:

- The website job and the deploy job are what matter. A separate job called **Firestore rules tests** may show red. That does not stop your website from deploying.
- The address is also shown in **Settings**, then **Pages**.

---

## Part 6. Build the Android app (APK)

1. Click the **Actions** tab.
2. Click **Android** in the list on the left.
3. Click **Run workflow**, then **Run workflow** again.
4. The first run takes 8 to 15 minutes. Wait for a green tick.
5. Click the finished run, scroll down to **Artifacts**, and download **Pupper-debug-apk**. It is a zip file.
6. Unzip it. Inside is `app-debug.apk`.
7. Send `app-debug.apk` to your Android phone (USB cable, Google Drive, WhatsApp to yourself, and so on).
8. On the phone tap the file. If asked, allow **Install unknown apps** for the app you opened it with. You need Android 8.0 or newer.
9. Open **Pupper** and sign in. An account made on the website works in the app, and the other way round.

---

## Part 7. Test with two accounts

1. Make two accounts: for example the website on your laptop and the app on your phone.
2. When you sign up, each account is **given its own 10-digit Pupper number automatically**.
3. Open **Settings** (tap your name or the gear). **Write your number down.** It cannot be changed.
4. In account A: **Add**, then **Add a chat**. Type account B's number and send a message. Account B should see it appear.
5. Try each of these:
   - a group: **Add**, **Add a group**, one number per line
   - a status: open the **Status** tab
   - a photo or video: the paperclip button on the website, **Media** in the app
   - a voice or video call: the phone and camera buttons, or the three-dot menu. Allow microphone and camera when asked.
   - a GIF (needs the optional key in Part 9)

Pupper numbers are not real phone numbers. They only work inside Pupper.

---

## Part 8. Share Pupper with friends

1. **Website:** send them `https://YOURUSERNAME.github.io/pupper/`. It works in any browser.
2. **Android app:** send them `app-debug.apk`. This is a test build, not on Google Play. They must allow **Install unknown apps** once. Android may show a warning screen. That is normal for a debug APK.
3. **How friends find you:** tell them your Pupper number. They type it under **Add**, then **Add a chat**.
4. Tell them that photos and videos go to a free public host. Anyone with the link can open them, and they cannot be deleted from Pupper. The app warns people the first time they send one.

### Changing the app later

- **Edit a file:** open it on GitHub, click the pencil icon, edit, then **Commit changes**. The workflows rebuild by themselves. You can also use **Run workflow**. A new APK appears under **Actions**, **Android**, **Artifacts**.
- **If you change `firestore.rules`:** also paste the new text into Firebase under **Firestore Database**, **Rules**, then click **Publish**. GitHub does not do this for you.
- **A new APK:** install it over the old one. Nothing is lost, because accounts and chats live in Firebase.
- **Change the logo:** replace these image files with new ones of the same name and size, then commit them:
  - `web/src/assets/pupper-logo.png` (512 by 512, transparent background)
  - `web/public/favicon.png` (96 by 96)
  - `android/app/src/main/res/drawable-nodpi/pupper_logo.png` (512 by 512)
  - the five `ic_launcher_foreground.png` files in `android/app/src/main/res/drawable-mdpi` up to `drawable-xxxhdpi` (108, 162, 216, 324 and 432 pixels square, with the logo centred and about 60% of the width)

---

## Part 9. Optional extras

You can skip all of these and Pupper still works.

### GIF search (Giphy)

1. Create a free key at https://developers.giphy.com (Create an App, then choose API).
2. In GitHub add a **Variable** `VITE_GIPHY_API_KEY` and a **Secret** `GIPHY_API_KEY`, both with your key.
3. Re-run the **Website** and **Android** workflows.

### Calls that work on every network (TURN)

Voice and video calls work on many home networks without this, but fail on some mobile or office networks.

1. Get a TURN server from a provider and check its current free limits.
2. In GitHub add **Variables** `VITE_TURN_URL` and `TURN_URL` (the address looks like `turn:host:3478`).
3. Add **Secrets** `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`, `TURN_USERNAME` and `TURN_CREDENTIAL`.
4. Re-run both workflows.

These values can be seen by anyone who inspects the site or app.

### If photo and video uploads fail on the website

Photos and videos go straight from the app to the free host catbox.moe (up to 200 MB each), and only the link is saved in the chat. The Android app should just work. I could not check whether the host allows uploads from a web page. If the website says the file host "could not be reached, or it blocked this website" while your internet works, use the proxy:

1. Create a free Cloudflare account.
2. Click **Workers & Pages**, **Create**, **Create Worker**. Name it `pupper-upload`, then **Deploy**.
3. Click **Edit code**, replace everything with the contents of `worker/catbox-proxy.js`, then **Deploy**.
4. Open the Worker's **Settings**, then **Variables and Secrets**. Add `ALLOWED_ORIGIN` with the value `https://YOURUSERNAME.github.io` (no path, no trailing slash). Optionally add `MAX_BYTES` with `100000000`.
5. Copy the Worker address, which looks like `https://pupper-upload.YOURNAME.workers.dev`.
6. In GitHub add **Variables** `VITE_UPLOAD_URL` (that address) and `VITE_MAX_UPLOAD_MB` (`100`). Cloudflare limits request sizes on its free plan, so check the current limit and match it.
7. Re-run the **Website** workflow.

### Delete expired statuses sooner

Old statuses are already hidden and removed by the time-to-live rule from step 2.5. To remove them within the hour, deploy the small function in `functions/`. This needs Firebase's pay-as-you-go plan, Node.js and the Firebase CLI on your computer:

```
npm i -g firebase-tools
firebase login
firebase use --add
cd functions
npm install
cd ..
firebase deploy --only functions
```

---

## Part 10. If something goes red

Because the code was never compiled before, a first-build error is possible.

1. Open the **Actions** tab and click the red run.
2. Click the red step.
3. Copy the red error lines.
4. Paste them to Claude together with the file name. A one-line fix usually solves it.
5. To change a file: open it on GitHub, click the pencil icon, edit, then **Commit changes**.
6. Re-run the workflow with **Run workflow**.

### Common problems

| What you see | Fix |
|---|---|
| Website says "Almost there" | A `VITE_FIREBASE_*` variable is missing or misspelled. Fix it and re-run **Website**. |
| App says "Almost there" | `FIREBASE_API_KEY` or `FIREBASE_APP_ID` is missing from Secrets. Fix it and re-run **Android**. |
| "Missing or insufficient permissions" | You skipped step 2.4, or the latest rules are not published. Paste `firestore.rules` into Firebase and click **Publish**. |
| Sign-in says "operation not allowed" | Turn on Email/Password in step 2.2. |
| Sign-in fails only on the website | Add `YOURUSERNAME.github.io` in step 2.8. |
| Website shows a blank page | Check **Settings**, **Pages**: Source must be **GitHub Actions**. Also check that `DEPLOY_PAGES` is `true`. |
| "No Pupper account has this number" | Check the 10 digits. Numbers are shown in the other person's Settings. |
| Call stays on "Connecting…" | Allow microphone and camera. Both people must be signed in with the app or page open. Add TURN from Part 9. |
| GIFs do not appear | Add the Giphy key from Part 9. |
| Photos or videos fail | See the Part 9 section on upload failures. Also check the file: only JPEG, PNG, WebP, GIF, MP4, WebM and MOV, up to 200 MB. |

---

## Good to know (limits)

- **No notifications when the app or tab is closed.** Messages and calls only notify while Pupper is open or running in the background. Real push needs a server that this project does not have.
- **Calls are one-to-one.** Group calls are not supported.
- **Photos and videos are public links** on a free outside host. You cannot delete them or moderate them from Pupper, and the host can change its rules or go offline. Do not use it for private material.
- **Statuses** are text only and last 24 hours.
- **Account deletion** removes the profile, number, saved contacts and sign-in. Messages already sent stay in other people's chats, and the deleted account's number cannot be recovered.
- **Messages are not end-to-end encrypted.** They are protected in transit and by the security rules, but they are readable in your Firebase project.
- **Nothing here was tested against real devices or a real Firebase project.** Expect to fix small things.
- Free-tier limits for Firebase, GitHub, Giphy and TURN providers change, so check their current pricing before relying on them.
