# userData

Deine Sammlung, Decks und Notizen leben **nicht in diesem Ordner**, sondern im
LocalStorage deines Browsers (zwei Schlüssel):

- `digimon.collection` — alle Karten-Kopien mit Preisen, Proxy-Status und Deck-Zuweisung
- `digimon.decks` — alle deine Listen (Decks, Wants, Trade)

Du kannst die Daten jederzeit als JSON exportieren oder einspielen über den
**Import / Export**-Tab in der App ("Backup herunterladen" / "Backup einspielen").
Empfehlung: lege heruntergeladene Backup-Dateien in diesen Ordner, damit du sie
nicht suchst.

Beim "Alle Daten löschen"-Button werden nur die beiden LocalStorage-Schlüssel
gelöscht, nicht die Dateien hier.




Updates Karten:
Update-Karten.bat läuft mit Python 3. Updated alle Karten die noch nicht in der App sind. 



Updates Pricings:
price_guide.json / products_singles.json kannst du hier jeweils runterladen und dann im Ordner ersetzen:
https://www.cardmarket.com/en/Magic/Data/Price-Guide
https://www.cardmarket.com/en/Magic/Data/Product-List
-> Danach ein mal Update-Preise ausführen.