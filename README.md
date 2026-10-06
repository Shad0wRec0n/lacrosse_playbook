# Annapolis Hawks Playbook

Animated plays and drills for the Hawks. Players open the site, enter the team password, and watch each play run step by step with coaching points beside the field.

## For players

1. Open the team site link Coach sent you.
2. Choose **Player**, enter the team password, and tick **Remember on this device** so you only do it once.
3. Tap a play. Press **Play** to watch it, or tap a coaching point to jump to that step.
4. Use **Follow** to highlight your position, **Speed** to slow it down, and **Trails** to see where everyone came from.

## For coaches: three ways to add a play

Sign in as **Coach** with the coach password. Coaches see the **Designer**, **+ New play**, **Edit in Designer** and their drafts; players see none of these and can only watch and print plays.

**1. Designer (drag and drop).** Open **Designer**.
- **Setup:** pick a formation, drag players to their spots, add opponents (red), cones or a coach, then use **Place ball**.
- **Steps:** press **+ Step**, then drag each player to where he goes. Drag the round handle to fine-tune the spot. Choose **Run / cut**, **Dodge** or **Pick** before you drag. Use **Pass**, **Ground ball**, **Scoop** and **Shot** for the ball. Type the coaching point for each step.
- **Curved and bent routes:** drag a diamond on a route to add a bend there. Each new leg gets its own diamond, so you can add as many bends as you need. Drag a bend point to move it, or tap it to remove it. In **Who moves when**, switch a route between **Curved** and **Sharp corners**, or **Straighten** it.
- **Looks:** tap **Look** to show the ball carrier's passing options at the end of a step. It starts with whoever has the ball when the step ends (change it with **Looking player**). Tap teammates to draw bright blue dotted arrows to them, or tap the goal for a shot look; tap again to remove one. Looks appear when the step finishes and clear when the next step starts. They never change where the ball goes, and they can be used in the same step as a real shot.
- **Who moves when:** actions in the same phase happen together, and Phase 2 starts when Phase 1 ends. Drag an action to another phase, or use ▲ ▼. Each later phase can start **after the one before ends**, **when it is halfway**, or **just after it begins**, so off-ball players can start moving while the ball carrier is still going. On the field, each arrow shows its phase number so players can see the order.
- Drafts save on your device automatically. **Preview** shows exactly what players will see.

**2. Paper.** In the Designer, open **Share & files → Print blank field for sketching**. Draw the play:
- circle each player's start spot and put an arrowhead at the finish
- solid line = run or cut, dashed = pass, zigzag = dodge, line with a T = pick, filled dot = ball
- write a step number (1, 2, 3…) on every line, and the coaching point for each step on the lines beside the field

Take a photo and send it to Claude, which turns it into an animated play.

**3. Text or slides.** Send the play as numbered steps (like the "M1 Passes to A1" slide) or as PowerPoint slides.

## Publishing a play to the team

Drafts are only on the device that made them. To publish one:

- **Option A:** in the Designer, use **Share & files → Copy play data** and paste it to Claude. Claude publishes it.
- **Option B:** use **Share & files → Download team file (.enc.json)**, then on GitHub open the `plays` folder, choose **Add file → Upload files**, and commit. The site picks it up within a minute or two. Uploading a file with the same name replaces the old version.

## Privacy and sign-in

Every play is encrypted with the team password (AES-256), so the files in this repository can't be read without it. Neither password is stored in the repo in readable form: `plays/keyinfo.json` holds only a check value and a copy of the team password sealed with the coach password.

The Player/Coach split stops players from accidentally changing plays. Even in the Designer, edits only ever save on that one device; a play only changes for the team when a coach publishes it to this GitHub repo, which needs write access to the repo.

Change the coach password:

```
HAWKS_PASSWORD=team HAWKS_COACH_PASSWORD=newcoach node tools/playbook.mjs coach
```

Change the team password (for example at the end of the season):

```
HAWKS_PASSWORD=old node tools/playbook.mjs decrypt decrypted
HAWKS_PASSWORD=new HAWKS_COACH_PASSWORD=coach node tools/playbook.mjs init --force
HAWKS_PASSWORD=new node tools/playbook.mjs encrypt decrypted/*.json
rm -r decrypted
```

## Logo

`assets/logo.png` is the club logo with the background removed; it is painted on the field. `assets/logo-outline.png` adds a white outline so it reads on the dark app background, and is used in the header, lock screen, favicon and print sheets.

## How it works

A static site with no build step and no server: plain HTML, CSS and JavaScript modules, hosted free on GitHub Pages.

| Path | What it is |
|---|---|
| `js/field.js` | Draws men's field markings to scale, in yards |
| `js/engine.js` | Play format and animation timing |
| `js/render.js` | Draws players, the ball and arrows |
| `js/app.js` | Password screen, playbook list, play viewer |
| `js/designer.js` | Drag-and-drop play designer |
| `js/crypto.js` | Team-password encryption |
| `tools/playbook.mjs` | Command-line tool to encrypt, decrypt and index plays |
| `plays/` | Encrypted plays, `index.json`, and `keyinfo.json` |
