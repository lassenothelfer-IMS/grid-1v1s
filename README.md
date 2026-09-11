# Grid 1v1

Zwei Spieler, ein 12×16-Raster, Bomben mit 1,5 Sekunden Zündschnur.
Spielbar **lokal an einem Gerät** oder **online über einen Raumcode**.

## Regeln

- Das Feld ist **12 Spalten × 16 Zeilen**. Spieler 1 startet oben, Spieler 2 unten.
- **Tippen** bewegt sofort genau ein Feld. **Halten** läuft weiter: nach 160 ms
  folgt alle 110 ms ein weiteres Feld. Ein kurzer Tipp wird so nie zu zwei Schritten.
- Hält man zwei Richtungen, gewinnt die zuletzt gedrückte; lässt man sie los,
  läuft man in die noch gehaltene weiter.
- Ein Druck, der während der kurzen Sperre (80 ms) ankommt, wird **160 ms lang
  gepuffert** und danach ausgeführt. Leicht zu früh getippt geht also nicht verloren.
- Eine **Bombe** zündet nach **1,5 Sekunden**. Wo sie erscheint und wie weit sie
  reicht, hängt von der Klasse ab (siehe unten).
- Die Explosion trifft das Bombenfeld plus den Radius **in jede Richtung** (Kreuzform)
  und bleibt 350 ms lang tödlich — auch für den, der sie gelegt hat.
- Bomben sind **fest**: man kann von der eigenen Bombe heruntergehen, aber nicht
  wieder darauf.
- **Eigene Bomben kosten erst beim 2. Treffer ein Leben.** Den ersten Treffer durch
  die eigene Bombe fängt ein Schutzschild ab — pro Leben einer. Gegnerisches Feuer
  trifft immer voll. Brennt auf einem Feld Feuer von beiden Spielern, zählt es als
  gegnerisches Feuer.
- Feuer zündet andere Bomben sofort. Jede Bombe explodiert dabei mit **ihrem eigenen**
  Radius — eine Speedy-Bombe bleibt klein, auch wenn eine Classic-Bombe sie auslöst.
- Fängt ein Schild einen Treffer ab, ist man **0,5 Sekunden unverwundbar** — länger
  als Feuer brennt, damit dieselbe Explosion nicht gleich das nächste Schild frisst.

## Runden

Ein Match wird in Runden gespielt, ähnlich wie in Counter-Strike.

- Vor **Runde 1** läuft ein Countdown: **3 · 2 · 1 · GO**. Bis GO kann niemand ziehen
  oder Bomben legen. Eine Richtungstaste, die man schon hält, läuft bei GO sofort los.
- Jeder hat so viele Leben, wie der Modus vorgibt (Blitz 3, Siege 7). **Verliert jemand
  ein Leben, endet die Runde** für beide:
  Das Spiel friert 1,5 Sekunden ein (keine Bewegung, keine Zündschnüre, kein Schaden),
  damit beide sehen, was passiert ist.
- Danach startet die **nächste Runde sofort mit GO**, ohne Countdown: beide Spieler
  zurück auf ihren Startfeldern, zerbrochene Kisten wieder da, alle Bomben und alles
  Feuer weg, Schilde wieder voll. Das Spielfeld bleibt das ganze Match über dasselbe.
- Ein Treffer, den ein Schild abfängt, beendet keine Runde.
- Fallen beide im selben Moment, ist die Runde unentschieden und beide verlieren ein
  Leben. Wer keine Leben mehr hat, verliert das Match; trifft es beide gleichzeitig:
  Unentschieden. Ein Match dauert so höchstens 2 × Leben − 1 Runden.
- Oben rechts steht ein Punkt pro möglicher Runde — nach der Runde in der Farbe
  dessen, der sie überlebt hat (halb/halb bei einem Unentschieden).

## Spielmodi

Vor der Klassenwahl wird der Modus gewählt; online entscheidet der Host.

| Modus | Leben | Runden höchstens |
|---|---|---|
| **Blitz** | 3 | 5 |
| **Siege** | 7 | 13 |

## Killstreaks und Fatality

- Gewinnt man eine Runde — der Gegner verliert ein Leben, man selbst nicht, egal wie er
  gefallen ist (auch durch die eigene Bombe) —, wächst die eigene **Killstreak** um 1.
  Verliert man selbst ein Leben, ist sie weg; eine unentschiedene Runde setzt beide zurück.
  Ein Treffer, den ein Schild abfängt, ist kein Kill.
- Ab **2 in Folge** blitzt ein Banner mit Namen und Streak über das Feld.
- Ab **4 in Folge** ist die **Fatality** freigeschaltet — als Finishing Move: Sie wirkt nur
  innerhalb von **2 Feldern** um den Gegner (auch diagonal). Die Zone wird in der Farbe des
  Jägers markiert, und unter dem Feld steht, wer gerade zuschlagen kann.
- Ab **5 in Folge** wirkt sie von **überall**.
- Taste: **X** (lokal Spieler 1 und online), **rechte Umschalttaste** (lokal Spieler 2).
  Nur in einer laufenden Runde; ein Druck außer Reichweite oder während des Countdowns
  bzw. Rundenendes verpufft.
- Die Fatality beendet das Match sofort, egal wie viele Leben der Gegner noch hat: Das Feld
  verdunkelt sich, ein Siegel schließt sich um das Opfer, es zerspringt, und „FATALITY"
  erscheint, bevor die Ergebniskarte kommt.
- In Blitz kommt man nie so weit — 3 Kills gewinnen dort schon das Match.

## Mauern und Kisten

Jedes Match — auch jede Revanche — bekommt ein neues, zufälliges Spielfeld. Zu Beginn
jeder Runde wird es wieder so hergestellt, wie es ausgeteilt wurde.

- **Mauern** sind unzerstörbar. Sie blockieren Bewegung und Feuer; Feuer endet vor
  ihnen. Sie kommen als einzelne Felder, gerade Stücke (2–3 Felder) oder kleine
  L-Formen.
- **Kisten** blockieren Bewegung und Feuer ebenfalls, zerbrechen aber beim ersten
  Treffer. Das Feuer brennt noch das Kistenfeld und stoppt dann — wer hinter einer
  Kiste steht, ist geschützt. Kisten sind 1×1, 2×1, 1×2 oder 2×2 groß und zerbrechen
  immer als Ganzes, egal welches ihrer Felder getroffen wird.
- **Fair:** Das Feld ist punktsymmetrisch — jedes Stück in der oberen Hälfte hat einen
  um 180° gedrehten Zwilling in der unteren. Die Felder um beide Startpunkte (2 Schritte)
  bleiben immer frei, und Mauern trennen das Feld nie in zwei Teile.
- Sniper-Bomben landen nie auf Mauern oder Kisten; ist der Gegner rundum eingemauert,
  gibt es keinen Schuss.

Pro Hälfte werden 1–2 Mauerstücke und 3–5 Kisten verteilt; alle Werte stehen in
`shared/constants.js`. Ein Spielfeld lässt sich über seinen Seed reproduzieren
(`createGame({ seed })`).

## Klassen

Vor jedem Match wählt jeder Spieler eine Klasse. Klassen verändern die Bomben und
wie viel man aushält — nicht die Laufgeschwindigkeit.

| Klasse | Bomben gleichzeitig | Radius | Wo die Bombe erscheint | Treffer pro Leben |
|---|---|---|---|---|
| **Classic** | 3 | 2 Felder | auf dem eigenen Feld | 1 (eigene Bombe: 2) |
| **Speedy** | 5 | 1 Feld | auf dem eigenen Feld | 1 (eigene Bombe: 2) |
| **Sniper** | 2 | 2 Felder | auf einem der 8 Felder **um den Gegner** | 1 (eigene Bombe: 2) |
| **Tank** | 2 | 1 Feld | auf dem eigenen Feld | 2 (eigene Bombe: 3) |

**Tank im Detail:** Die Panzerung fängt einen Treffer von *jeder* Bombe ab. Trifft
sich der Tank selbst, wird zuerst der Schild gegen eigene Bomben verbraucht, dann die
Panzerung — die beiden stapeln sich. Im HUD steht neben den Leben je eine Raute pro
Schild: gelb gegen die eigene Bombe, weiß für die Panzerung. Verbrauchte bleiben als
Umriss sichtbar.

**Sniper im Detail:** Der Schuss landet zufällig auf einem der 8 Nachbarfelder des
Gegners; belegte Felder fallen weg. Er ist nur möglich, wenn der Sniper **mindestens
4 Felder** vom Gegner entfernt steht — gemessen als Ringabstand, also
`max(|dx|, |dy|)`, passend zum Ring aus 8 Feldern. Solange ein Schuss möglich ist,
werden die Zielfelder im Spiel gestrichelt markiert. Ist der Sniper zu nah oder liegt
der Gegner gerade gefallen, passiert beim Drücken nichts.

## Steuerung

| | Bewegen | Bombe | Fatality |
|---|---|---|---|
| **Lokal** — Spieler 1 | `W` `A` `S` `D` | `Space` | `X` |
| **Lokal** — Spieler 2 | Pfeiltasten | `Enter` | rechte `Shift` |
| **Online** | `WASD` oder Pfeiltasten | `Space` oder `Enter` | `X` |

Die Oberfläche des Spiels ist komplett auf Englisch.

## Starten

```bash
npm install
npm start
```

Dann [http://localhost:3000](http://localhost:3000) öffnen. Port ändern mit `PORT=8080 npm start`.

**Lokal:** „Local“ im Menü, dann den Modus, dann wählt erst Player 1 und danach Player 2
eine Klasse.

**Online:** Ein Spieler wählt „Create room“, den Modus und seine Klasse und teilt den
4-stelligen Code. Der zweite wählt „Join room“, gibt den Code ein und wählt seine
Klasse — das Match startet automatisch, sobald beide da sind.

## Design

Die Oberfläche folgt dem Design-System **Nocturne** aus Claude Design, genauer den
Vorlagen *Arena — Sigil* (Spielfeld) und *Arena — Profile & Loadout* (Klassenwahl):
Glut (Spieler 1) und Violett (Spieler 2) auf fast schwarzem Grund, Cormorant Garamond
für Namen und Titel, IBM Plex Mono für Daten, ein Ritualkreis über dem Feld. Alle
Farben, Schriften und Maße stehen am Anfang von `public/styles.css` bzw. in
`public/render.js`; beide Dateien sind reine Darstellung und ändern keine Spielregel.

Mauern sind die erhabenen Steinfelder der Vorlage, Kisten ihre bernsteinfarbenen
Reliquiare. Rangliste, Relikte und Saison-Daten der Vorlage sind durch echte
Spielinformationen ersetzt: Klassenwerte, Schilde, freie Bomben und ein Ereignis-Ticker.

## Aufbau

```
grid1v1/
├── shared/            # Spielregeln — identisch für Browser und Server
│   ├── constants.js   # Feldgröße, Timings, Klassen-Werte
│   └── engine.js      # reine Logik: createGame / step / requestMove / setHeld / requestBomb
├── public/            # Client
│   ├── index.html
│   ├── main.js        # Menü, Klassenwahl, Render-Loop, lokal + online
│   ├── render.js      # Canvas-Zeichnung inkl. Bewegungsglättung
│   ├── input.js       # Tastatur: Druck und gehaltene Richtung, getrennt gemeldet
│   └── net.js         # WebSocket-Wrapper
├── server.js          # Statische Dateien + Räume + autoritative Simulation
└── test/              # Regel- und Netzwerktests
```

Die Engine in `shared/` ist die **einzige Quelle der Spielregeln**. Sie kennt weder
DOM noch Sockets und bekommt ihre Zeit von außen (`step(state, dtMs)`):

- **Lokal** läuft sie im Browser, getrieben von `requestAnimationFrame`.
- **Online** läuft sie ausschließlich auf dem Server (60 Hz Simulation, 20 Hz
  Snapshots). Der Client schickt nur Absichten (`move`, `hold`, `bomb`) und zeichnet,
  was zurückkommt — es gibt bewusst keine Client-Prediction.
- Der Server-Loop holt verspätete Timer in **festen 16-ms-Schritten** nach (bis zu
  250 ms). So läuft die Spielzeit auch unter Last synchron mit der echten Zeit,
  statt in Zeitlupe zu rutschen.

**Bewegungsglättung** ist rein optisch und lebt in `render.js`: die Engine kennt nur
ganze Felder, die Figur gleitet aber mit einer Zeitkonstante von 34 ms zwischen ihnen.
Rundenstarts und Sprünge über mehr als ein Feld springen hart, statt über das Feld zu
gleiten. Das glättet auch die 20-Hz-Snapshots im Online-Modus.

Neue Klasse hinzufügen: einen Eintrag in `CLASSES` in `shared/constants.js` ergänzen.
Menü, HUD und Server lesen die Liste automatisch aus.

## Tests

```bash
npm test
```

Prüft die Regeln headless: Tippen vs. Halten, Richtungswechsel beim Halten,
Eingabepuffer, Spielfeldgrenzen, Zündschnur, Radien und Bombenlimits je Klasse,
Sniper-Zielfelder und Mindestabstand, Schild gegen eigene Bomben, gemischtes Feuer,
Tank-Panzerung und ihr Stapeln, Kettenreaktionen, Sieg und Unentschieden. Runden:
Countdown, eingefrorenes Rundenende, Neustart auf den Startfeldern mit
wiederhergestellten Kisten, unentschiedene Runden und das Matchende. Dazu 500 zufällige Spielfelder (symmetrisch, freie Startpunkte, nie
geteilt, verschiedene Größen) und wie Mauern und Kisten Bewegung, Feuer und Sniper
beeinflussen. Die älteren Regeltests laufen auf einem leeren Feld
(`obstacles: false`, `countdownMs: 0`), damit weder ein Zufallsfeld noch der
Countdown sie stört.

```bash
npm start          # in einem Terminal
npm run test:online
```

Fährt einen echten Match über zwei WebSocket-Clients: Raum anlegen, beitreten,
Klassenwahl, Spielfeld vom Server (gleich für beide, symmetrisch, neu bei der
Revanche), Countdown und Rundenwechsel, Tippen und Halten, Sniper-Schuss, Zündschnur in Spielzeit, einen Tank,
der sich Treffer für Treffer selbst besiegt, Spielende, Revanche und
Verbindungsabbruch. Der Test wartet auf Spielzustände statt auf feste Zeiten und
läuft deshalb auch auf einem ausgelasteten Rechner stabil.

## Bekannte Grenzen

- Räume liegen **im Speicher** — ein Serverneustart beendet laufende Matches.
- Verlässt ein Spieler den Raum, wird der Raum geschlossen; eine Revanche ist nur
  möglich, solange beide verbunden sind.
- Kein Lag-Ausgleich. Auf hohe Latenz reagiert die eigene Figur spürbar verzögert.
- Nur Tastatursteuerung, also aktuell kein Touch-Support.
