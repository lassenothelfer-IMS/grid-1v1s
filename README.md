# Grid 1v1

Zwei Spieler, ein 12×16-Raster, Bomben mit 1,5 Sekunden Zündschnur.
Spielbar **lokal an einem Gerät** oder **online über einen Raumcode**.

## Regeln

- Das Feld ist **12 Spalten × 16 Zeilen**. Spieler 1 startet oben, Spieler 2 unten.
- **Ein Tastendruck = ein Feld.** Eine Taste gedrückt zu halten bewegt nicht weiter —
  die Auto-Repeat-Wiederholung des Systems wird verworfen. Wer schneller laufen
  will, muss schneller tippen.
- Ein Druck, der während der kurzen Sperre (80 ms) ankommt, wird **160 ms lang
  gepuffert** und danach ausgeführt. Leicht zu früh getippt geht also nicht verloren.
- Eine **Bombe** zündet nach **1,5 Sekunden**. Wo sie erscheint und wie weit sie
  reicht, hängt von der Klasse ab (siehe unten).
- Die Explosion trifft das Bombenfeld plus den Radius **in jede Richtung** (Kreuzform)
  und bleibt 350 ms lang tödlich — auch für den, der sie gelegt hat.
- Bomben sind **fest**: man kann von der eigenen Bombe heruntergehen, aber nicht
  wieder darauf. Wer im Feuer steht, verliert ein Leben.
- Feuer zündet andere Bomben sofort. Jede Bombe explodiert dabei mit **ihrem eigenen**
  Radius — eine Speedy-Bombe bleibt klein, auch wenn eine Classic-Bombe sie auslöst.
- Jeder hat **3 Leben**. Nach einem Treffer respawnt man am eigenen Startfeld mit
  **1,5 Sekunden Unverwundbarkeit** (als Ring um die Figur sichtbar).
- Wer keine Leben mehr hat, verliert. Trifft es beide im selben Moment: Unentschieden.

## Klassen

Vor jedem Match wählt jeder Spieler eine Klasse. Klassen verändern **nur die Bomben**,
nicht die Laufgeschwindigkeit.

| Klasse | Bomben gleichzeitig | Radius | Wo die Bombe erscheint |
|---|---|---|---|
| **Classic** | 2 | 2 Felder | auf dem eigenen Feld |
| **Speedy** | 5 | 1 Feld | auf dem eigenen Feld |
| **Sniper** | 2 | 2 Felder | auf einem der 8 Felder **um den Gegner** |

**Sniper im Detail:** Der Schuss landet zufällig auf einem der 8 Nachbarfelder des
Gegners; belegte Felder fallen weg. Er ist nur möglich, wenn der Sniper **mindestens
4 Felder** vom Gegner entfernt steht — gemessen als Ringabstand, also
`max(|dx|, |dy|)`, passend zum Ring aus 8 Feldern. Solange ein Schuss möglich ist,
werden die Zielfelder im Spiel gestrichelt markiert. Ist der Sniper zu nah oder liegt
der Gegner gerade im Respawn, passiert beim Drücken nichts.

## Steuerung

| | Bewegen | Bombe |
|---|---|---|
| **Lokal** — Spieler 1 | `W` `A` `S` `D` | `Space` |
| **Lokal** — Spieler 2 | Pfeiltasten | `Enter` |
| **Online** | `WASD` oder Pfeiltasten | `Space` oder `Enter` |

## Starten

```bash
npm install
npm start
```

Dann [http://localhost:3000](http://localhost:3000) öffnen. Port ändern mit `PORT=8080 npm start`.

**Lokal:** „Lokal — 1 Gerät“, dann wählt erst Spieler 1 und danach Spieler 2 eine Klasse.

**Online:** Ein Spieler wählt „Raum erstellen“ und seine Klasse und teilt den
4-stelligen Code. Der zweite wählt „Raum beitreten“, gibt den Code ein und wählt seine
Klasse — das Match startet automatisch, sobald beide da sind.

## Aufbau

```
grid1v1/
├── shared/            # Spielregeln — identisch für Browser und Server
│   ├── constants.js   # Feldgröße, Timings, Klassen-Werte
│   └── engine.js      # reine Logik: createGame / step / requestMove / requestBomb
├── public/            # Client
│   ├── index.html
│   ├── main.js        # Menü, Klassenwahl, Render-Loop, lokal + online
│   ├── render.js      # Canvas-Zeichnung inkl. Bewegungsglättung
│   ├── input.js       # Tastatur (ein Druck = ein Feld, Auto-Repeat verworfen)
│   └── net.js         # WebSocket-Wrapper
├── server.js          # Statische Dateien + Räume + autoritative Simulation
└── test/              # Regel- und Netzwerktests
```

Die Engine in `shared/` ist die **einzige Quelle der Spielregeln**. Sie kennt weder
DOM noch Sockets und bekommt ihre Zeit von außen (`step(state, dtMs)`):

- **Lokal** läuft sie im Browser, getrieben von `requestAnimationFrame`.
- **Online** läuft sie ausschließlich auf dem Server (60 Hz Simulation, 20 Hz
  Snapshots). Der Client schickt nur Absichten (`move`, `bomb`) und zeichnet, was
  zurückkommt — es gibt bewusst keine Client-Prediction.

**Bewegungsglättung** ist rein optisch und lebt in `render.js`: die Engine kennt nur
ganze Felder, die Figur gleitet aber mit einer Zeitkonstante von 34 ms zwischen ihnen.
Respawns und Sprünge über mehr als ein Feld springen hart, statt über das Feld zu
gleiten. Das glättet auch die 20-Hz-Snapshots im Online-Modus.

Neue Klasse hinzufügen: einen Eintrag in `CLASSES` in `shared/constants.js` ergänzen.
Menü, HUD und Server lesen die Liste automatisch aus.

## Tests

```bash
npm test
```

Prüft die Regeln headless (49 Checks): Feldgröße, ein Feld pro Druck, dass Halten
nichts tut, Eingabepuffer, Spielfeldgrenzen, Zündschnur, Radien je Klasse,
Bombenlimits, Sniper-Zielfelder und Mindestabstand, Kettenreaktionen mit
gemischten Radien, Schaden, Respawn, Sieg und Unentschieden.

```bash
npm start          # in einem Terminal
npm run test:online
```

Fährt einen echten Match über zwei WebSocket-Clients: Raum anlegen, beitreten,
Klassenwahl, Eingaben, Sniper-Schuss, Spielende, Revanche und Verbindungsabbruch.

## Bekannte Grenzen

- Räume liegen **im Speicher** — ein Serverneustart beendet laufende Matches.
- Verlässt ein Spieler den Raum, wird der Raum geschlossen; eine Revanche ist nur
  möglich, solange beide verbunden sind.
- Kein Lag-Ausgleich. Auf hohe Latenz reagiert die eigene Figur spürbar verzögert.
- Nur Tastatursteuerung, also aktuell kein Touch-Support.
