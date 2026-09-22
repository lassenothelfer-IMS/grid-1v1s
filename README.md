# Grid 1v1

Zwei Spieler, ein 12×16-Raster, Bomben mit 1 Sekunde Zündschnur.
Spielbar **lokal an einem Gerät** oder **online über einen Raumcode** — online auch
als **2v2** mit vier Geräten.

## Regeln

- Das Feld ist **12 Spalten × 16 Zeilen**. Spieler 1 startet oben, Spieler 2 unten.
- **Tippen** bewegt sofort genau ein Feld. **Halten** läuft weiter: nach 160 ms
  folgt alle 110 ms ein weiteres Feld. Ein kurzer Tipp wird so nie zu zwei Schritten.
- Hält man zwei Richtungen, gewinnt die zuletzt gedrückte; lässt man sie los,
  läuft man in die noch gehaltene weiter.
- Ein Druck, der während der kurzen Sperre (80 ms) ankommt, wird **160 ms lang
  gepuffert** und danach ausgeführt. Leicht zu früh getippt geht also nicht verloren.
- Eine **Bombe** zündet nach **1 Sekunde**. Wo sie erscheint und wie weit sie
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

Auf demselben Bildschirm stellt man außerdem die **Killcam** an oder aus (siehe unten), und
beim Erstellen eines Online-Raums das Format: **1v1** oder **2v2**.

## 2v2

Online können vier Leute in zwei Teams spielen — jeder auf seinem eigenen Gerät.

- Der Host wählt beim Erstellen „2v2". Wer beitritt, landet in der **Lobby**: vier Plätze,
  zwei pro Seite (oben/unten). Mit einem Tipp auf einen freien Platz wechselt man die Seite.
  Das Match startet erst, wenn der Host auf **Start match** drückt — und nur, wenn alle vier
  da sind.
- Jedes Team startet von zwei eigenen Startfeldern; alle vier sind punktsymmetrisch und
  bleiben frei von Mauern und Kisten.
- **Leben und Killstreak gehören dem Team.** Wer getroffen wird, ist für den Rest der Runde
  raus (eine Aschemarkierung zeigt, wo); die Runde endet erst, wenn **ein Team niemanden mehr
  stehen hat**. Dieses Team verliert ein Leben. Fallen beide Teams im selben Moment:
  unentschiedene Runde.
- **Eigenbeschuss:** Feuer des Teammitglieds zählt wie das eigene — der Schild gegen eigene
  Bomben fängt den ersten Treffer ab, und ein Treffer am Teamkollegen ist kein Kill.
- **Gemeinsame Fatality:** Ab 4 gewonnenen Runden in Folge kann jedes Teammitglied die
  Fatality auslösen (innerhalb von 2 Feldern um irgendeinen Gegner, ab 5 von überall). Sie
  beendet das Match für das ganze gegnerische Team.
- Im 2v2 trägt der Ring um die Figuren des unteren Teams eine Raute statt eines Kreises —
  so erkennt man Teamkollegen auch bei frei gewählten Farben.
- Verliert jemand die Verbindung, pausiert das Match für alle, wie im 1v1. Verlässt ein Gast
  die Lobby, wird nur sein Platz frei; verlässt jemand ein laufendes Match, endet es.

## Bots

Gegen den Computer spielen — allein oder als Lückenfüller online.

- **Solo:** Im Menü „Play vs bots“, dann Format (**1v1** oder **2v2** — dann mit einem Bot
  als Teamkollegen), Schwierigkeit (**Easy**, **Medium**, **Hard**), Killcam und Modus. Die Bots
  bekommen Namen, freie Farben und zufällige Klassen. „Play again“ spielt gegen dieselben
  Bots, „New bots“ würfelt neue aus.
- **Online:** Wer einen 1v1-Raum erstellt, kann statt auf einen Gegner zu warten sofort einen
  Bot auf den freien Platz setzen. In der 2v2-Lobby hat der Host neben jedem freien Platz
  „+ Bot“ (Schwierigkeit unter „New bots“) und neben jedem Bot ein ✕, um ihn wieder
  herauszunehmen. Online laufen die Bots auf dem Server.
- **Fair:** Ein Bot sieht nur, was ein Mensch auf seinem Platz sehen dürfte — ein versteckter
  Shade täuscht ihn genauso, und einen Decoy hält er für echt. Er drückt dieselben „Tasten“
  wie ein Spieler (Schritt, Bombe, Fähigkeit, Fatality) und kann nicht schneller laufen, als
  die Regeln erlauben. Deshalb ist Shade im Solo-Modus freigeschaltet.
- **Wie er denkt:** Für jedes Feld berechnet der Bot, wann dort Feuer brennen wird — von allen
  Bomben auf dem Feld, Kettenreaktionen eingeschlossen. Wege sucht er Schritt für Schritt in
  der Zeit und betritt nie ein Feld, während es brennt. Er legt nur eine Bombe, wenn sie einen
  Gegner treffen (oder eine Kiste auf dem Weg öffnen) würde **und** er danach noch einen
  sicheren Fluchtweg hat. Hard stellt zusätzlich Fallen: Bomben, die dem Gegner jeden Ausweg
  nehmen. Sniper halten Abstand, Line-Bots richten sich auf einen Gegner aus, Decoy-Bots
  setzen ihren Köder, wenn jemand nah ist, und jeder Bot nimmt eine angebotene Fatality.
- **Die Stufen** unterscheiden sich in Reaktionszeit (Easy 0,42 s, Medium 0,22 s, Hard 0,11 s),
  Laufgeschwindigkeit, Sicherheitsabstand zum Feuer und Angriffslust; Easy übersieht auch mal
  eine Gefahr. Die Werte stehen in `shared/bot.js`.

## Namen und Farben

Über den Klassenkarten stehen ein **Namensfeld** und **sechs Farben** (Ember, Violet, Jade,
Frost, Crimson, Pearl). Beides merkt sich das Gerät — lokal für beide Spieler getrennt,
online für dich. Namen werden auf 14 Zeichen gekürzt; leer bleibt es „Player 1" usw.
Eine Farbe gibt es pro Match nur einmal: lokal ist die von Player 1 für Player 2 gesperrt,
online bekommt man die nächste freie, wenn die gewünschte schon vergeben ist. Die Farbe färbt
alles, was zu einem Spieler gehört: Figur, Bomben-Rand, Startfeld, Karte, Leben, Ticker,
Rundenpunkte, Touch-Leiste.

## Killcam

Ist die Killcam an (Standard), wird nach jeder Runde **die letzte Sekunde vor dem
entscheidenden Treffer in Zeitlupe** (0,4×) wiederholt — mit Balken oben und unten, einem
Fadenkreuz, wo es passiert ist, und wer wen erwischt hat (oder „own bomb"). Die Pause nach der
Runde dauert dafür 3,4 statt 1,5 Sekunden. Ist eine Fatality möglich, entfällt die Killcam, und
die Pause bleibt kurz — der Finisher hat Vorrang. Auch der letzte Kill eines Matches läuft noch
einmal, bevor die Ergebniskarte kommt (außer bei einer Fatality, die ihre eigene Animation
hat). Online zeigt die Killcam genau das, was man selbst gesehen hat — ein versteckter Shade
bleibt auch in der Wiederholung unsichtbar.

## Match-Statistik

Die Ergebniskarte zeigt pro Spieler: **Kills, Tode, gelegte Bomben, zerstörte Kisten, Near
Misses** (gegnerisches Feuer direkt neben einem, das einen nicht getroffen hat), **abgefangene
Treffer, Selbstzerstörungen** und die **längste Serie**. Der Bestwert jeder Zeile leuchtet in
der Farbe seines Spielers (bei Toden der niedrigste). Kisten gehören dem, dessen Feuer sie
zuerst erreicht; ein Kill dem Gegner, dessen Feuer auf dem Feld brannte.

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
| **Quickfuse** | 3 | 1 Feld | auf dem eigenen Feld, Zündschnur **0,53 s** | 1 (eigene Bombe: 2) |
| **Diagonal** | 3 | 2 Felder, als **X** | auf dem eigenen Feld | 1 (eigene Bombe: 2) |
| **Line** | 2 | eine Richtung **bis zum Rand** | auf dem eigenen Feld | 1 (eigene Bombe: 2) |
| **Shade** | 2 | 2 Felder | auf dem eigenen Feld; wird unsichtbar | 1 (eigene Bombe: 2) |
| **Decoy** | 2 | 2 Felder | auf dem eigenen Feld; Fähigkeit: Köder | 1 (eigene Bombe: 2) |

**Quickfuse im Detail:** Die Bombe zündet schon nach 0,53 Sekunden (dasselbe Verhältnis zur normalen Zündschnur wie früher 0,8 zu 1,5), der Ring um die Bombe läuft
entsprechend schneller ab. Dafür reicht das Feuer nur ein Feld weit.

**Diagonal im Detail:** Das Feuer geht in die vier Diagonalen statt geradeaus — gerade neben
der Bombe ist man sicher, schräg daneben nicht. Mauern und Kisten stoppen auch die Diagonalen.
Die Bombe trägt ein kleines Kreuz.

**Line im Detail:** Das Feuer schießt nur in eine Richtung, dafür bis zum Spielfeldrand (Mauern
stoppen es, Kisten zerbrechen und stoppen es). Die Richtung ist die, in die man zuletzt gelaufen
ist oder laufen wollte — gegen eine Wand oder den Rand drücken dreht einen, ohne zu gehen. Ein
kleiner Pfeil an der Figur zeigt die Blickrichtung; liegt die Bombe, markieren schwache Pfeile
die Bahn, die sie gleich abbrennt. Auf dem eigenen Bombenfeld selbst brennt es natürlich auch.

**Shade im Detail (nur online):** Wer eine Sekunde stillsteht, verschwindet vom Bildschirm des
gegnerischen Teams. Ein einzelner Schritt hält einen versteckt; ein zweiter Schritt, bevor man
wieder eine Sekunde stand, macht einen sichtbar — ebenso eine gelegte Bombe, ein abgefangener
Treffer oder ein Gegner, der in einen hineinläuft. Sniper können einen versteckten Shade nicht
anvisieren, und eine Fatality auf 2 Felder braucht Sichtkontakt (ab 5 in Folge nicht). Der Server
schickt dem gegnerischen Team **gar keine Position** für einen versteckten Shade — auch nicht
im Ereignis-Log —, man kann ihn also nicht aus den Netzwerkdaten lesen. Das eigene Team sieht
ihn halbdurchsichtig. Lokal ist die Klasse gesperrt, weil beide auf denselben Bildschirm schauen.

**Decoy im Detail:** Die Fähigkeitstaste setzt eine Kopie von dir auf dein Feld, für
**3 Sekunden** (danach 3 Sekunden Abklingzeit, also alle 6 Sekunden). Die Kopie macht jeden
deiner Schritte mit — hoch und runter gleich, links und rechts gespiegelt. Für das gegnerische
Team sieht sie genau wie du aus und blockiert wie ein Spieler; dein Team sieht sie
halbdurchsichtig. Feuer lässt sie zerplatzen. Ein Sniper zielt auf das nähere der beiden Ziele
— auch auf die Kopie.

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

| | Bewegen | Bombe | Fähigkeit (Decoy) | Fatality |
|---|---|---|---|---|
| **Lokal** — Spieler 1 | `W` `A` `S` `D` | `Space` | `E` | `X` |
| **Lokal** — Spieler 2 | Pfeiltasten | `Enter` | `.` oder rechte `Strg` | rechte `Shift` |
| **Online** | `WASD` oder Pfeiltasten | `Space` oder `Enter` | `E` oder `.` | `X` |

Die Tasten sind nach ihrer Position belegt, nicht nach der Beschriftung — auf einer deutschen
Tastatur liegen sie also an denselben Stellen. Auf Touch-Geräten erscheint für Decoy ein
dritter Knopf (◎) mit Abklingzeit.

Die Oberfläche des Spiels ist komplett auf Englisch.

## Verbindungsabbrüche

Handys verlieren ständig kurz die Verbindung — App wechseln, um den Raumcode zu teilen,
Bildschirm sperren, WLAN wechselt auf mobile Daten. Deshalb beendet ein Abbruch das Match
nicht mehr:

- Wer die Verbindung verliert, **behält seinen Platz**: im Match 30 Sekunden, in der Lobby
  3 Minuten (Zeit genug, den Code per Nachricht zu schicken).
- Das Match **pausiert** solange; der andere sieht „Player 2 lost connection“ mit den
  verbleibenden Sekunden.
- Das Handy **verbindet sich selbst neu** und weist sich mit einem geheimen Token aus, das
  pro Browser-Tab gespeichert ist — auch wenn iOS den Tab im Hintergrund neu geladen hat.
  Weiter geht es mit einem 3-2-1.
- Kommt eine neue Verbindung, bevor der Server die alte als tot erkannt hat, gewinnt die
  neue.
- Der Server schickt alle 20 Sekunden einen Ping. Das hält Proxys davon ab, stille
  Verbindungen (Lobby, Ergebnis) zu kappen, und findet Verbindungen, die lautlos gestorben
  sind.
- Wer bewusst geht (Hauptmenü, Abbrechen), meldet das dem Server — dann schließt der Raum
  sofort.
- Ein kaputtes WebSocket-Paket kann den Server nicht mehr zum Absturz bringen.

Die Wartezeiten lassen sich per Umgebungsvariable ändern: `RECONNECT_GRACE_MS`,
`LOBBY_GRACE_MS`, `HEARTBEAT_MS`.

## Handy und iPad

Auf Touch-Geräten erscheinen im Match eigene Bedienelemente; eine Tastatur funktioniert
trotzdem weiter.

- **D-Pad** für den linken Daumen: Tippen = ein Feld, Halten = weiterlaufen, mit dem
  Daumen auf einen anderen Pfeil gleiten = abbiegen — genau wie auf der Tastatur.
- **Bombe** (◉, mit Anzeige der freien Bomben) und **Fatality** (✠, gesperrt bis zur
  4er-Serie, pulsiert, sobald sie möglich ist) für den rechten Daumen. Mehrere Finger
  gleichzeitig gehen, also laufen und Bombe legen zugleich.
- **Online** bekommt man eine Leiste für sich selbst unten am Rand.
- **Lokal: Tischmodus.** Das iPad (oder Handy) liegt flach zwischen zwei Leuten; jeder
  hat seine Leiste an seiner Kante, die von Spieler 1 um 180° gedreht, damit sie zu ihm
  schaut. Hochkant liegen die Leisten über und unter dem Feld, quer in den Ecken daneben.
- **Als App:** Im Browser „Zum Home-Bildschirm“ wählen — dann startet das Spiel im
  Vollbild ohne Browserleisten, mit eigenem Icon.
- Während eines Matches geht der Bildschirm nicht aus (wo der Browser es erlaubt), und
  Zoomen per Doppeltipp oder zwei Fingern ist gesperrt.
- Zum Testen am Computer: `?touch` an die Adresse hängen erzwingt die Touch-Oberfläche.

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
│   ├── bot.js         # Computergegner (Feuervorhersage, Wegsuche in der Zeit, Stufen)
│   ├── constants.js   # Feldgröße, Timings, Klassen-Werte
│   └── engine.js      # reine Logik: createGame / step / requestMove / setHeld / requestBomb
├── public/            # Client
│   ├── index.html
│   ├── main.js        # Menü, Klassenwahl, Render-Loop, lokal + online
│   ├── render.js      # Canvas-Zeichnung inkl. Bewegungsglättung
│   ├── input.js       # Tastatur: Druck und gehaltene Richtung, getrennt gemeldet
│   ├── touch.js       # Touch-Steuerung: D-Pad, Bombe, Fähigkeit, Fatality, Tischmodus
│   ├── palette.js     # die sechs Spielerfarben (für Canvas und CSS)
│   ├── manifest.webmanifest, icons/  # „Zum Home-Bildschirm" als App
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
beeinflussen. Außerdem die neuen Klassen (Quickfuse-Zündschnur, X-Muster, Line-Richtung
und -Reichweite, Shade verschwinden/leiser Schritt/aufgedeckt/Ansicht ohne Position,
Decoy spiegeln/blockieren/Abklingzeit/zerplatzen/Sniper-Ziel), 2v2 (Teams, Rundenende erst
bei ausgelöschtem Team, gemeinsame Leben und Serie, Eigenbeschuss, Team-Fatality),
Namen und Farben, die Match-Statistik und die Killcam-Pause. Die älteren Regeltests laufen auf einem leeren Feld
(`obstacles: false`, `countdownMs: 0`), damit weder ein Zufallsfeld noch der
Countdown sie stört.

```bash
npm start          # in einem Terminal
npm run test:online
```

```bash
npm run test:reconnect
```

Startet einen eigenen Server mit kurzen Wartezeiten und prüft Verbindungsabbrüche:
Abbruch mitten im Match und Rückkehr per Token, Pause und 3-2-1, veraltete Verbindung,
abgelaufene Wartezeit, bewusstes Verlassen, Host verlässt kurz die Lobby, falsches Token,
Heartbeat und ein kaputtes Paket.

```bash
npm run test:bots
```

Lässt Bots headless ganze Matches spielen: Ein Hard-Bot findet und besiegt auf echten
Spielfeldern einen Gegner, der stillsteht (mit jeder Klasse), Medium und Hard entkommen einer
Bombe direkt unter ihnen, die Stufen schlagen sich in der erwarteten Reihenfolge, Hard gegen
Hard kämpft ohne sich selbst in die Luft zu jagen, vier Bots spielen ein 2v2 zu Ende, und eine
angebotene Fatality wird genommen.

```bash
npm run test:teams
```

Startet ebenfalls einen eigenen Server und spielt 2v2 mit vier Clients: Lobby, Farbkonflikt,
Platzwechsel, fünfter Spieler abgewiesen, nur der Host startet, Teams und Namen im Match, ein
versteckter Shade (Teamkollege sieht ihn, Gegner bekommen keine Position), Decoy übers Netz,
Verbindungsabbruch und Rückkehr, Lobby verlassen, Namen/Farben im 1v1 sowie Bots in Online-Räumen
(1v1 mit Bot starten, Bots in der 2v2-Lobby setzen und entfernen, nur durch den Host).

`npm run test:online` fährt einen echten Match über zwei WebSocket-Clients: Raum anlegen, beitreten,
Klassenwahl, Spielfeld vom Server (gleich für beide, symmetrisch, neu bei der
Revanche), Countdown und Rundenwechsel, Tippen und Halten, Sniper-Schuss, Zündschnur in Spielzeit, einen Tank,
der sich Treffer für Treffer selbst besiegt, Spielende, Revanche und
Verbindungsabbruch. Der Test wartet auf Spielzustände statt auf feste Zeiten und
läuft deshalb auch auf einem ausgelasteten Rechner stabil.

## Bekannte Grenzen

- Räume liegen **im Speicher** — ein Serverneustart beendet laufende Matches.
- Verlässt ein Spieler ein laufendes Match, wird der Raum geschlossen; eine Revanche ist
  nur möglich, solange alle verbunden sind.
- Kein Lag-Ausgleich. Auf hohe Latenz reagiert die eigene Figur spürbar verzögert.
- 2v2 gibt es nur online — vier Spieler an einer Tastatur blockieren sich gegenseitig die
  Tasten.
- Welche Figur ein Decoy ist, steht in den Netzwerkdaten (anders als beim Shade). Im Bild
  sind beide gleich; wer die Rohdaten mitliest, könnte es sehen.
