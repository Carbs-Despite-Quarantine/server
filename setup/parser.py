import csv

# Data storage for parsed cards

class Card:
    def __init__(self, text, pack, versions=None):
        self.text = text
        self.pack = pack
        self.versions = versions

class BlackCard(Card):
    def __init__(self, text, draw, pick, pack, versions=None):
        super().__init__(text, pack, versions)
        self.draw = draw
        self.pick = pick

blackCards = []
whiteCards = []

def parseCard(row, pack):
    if row[0] == "Prompt" or row[0] == "Response":
        text = row[1].replace("'", "\\'").replace("\n", "\\n")
        versions = []
        if pack == "base":
            for i in range(3, len(row)):
                if len(row[i]) > 0 and versionNames[i] is not None:
                    versions.append(versionNames[i])
        if row[0] == "Prompt":
            special = row[2]
            draw = 2 if "DRAW 2" in special else 0
            pick = 1
            if "PICK 2" in special:
                pick = 2
            elif "PICK 3" in special:
                pick = 3
            blackCards.append(BlackCard(text, draw, pick, pack, versions))
        else:
           whiteCards.append(Card(text, pack, versions))

# Parse the base game cards
with open ("basecards.csv") as basecards:
  csv_reader = csv.reader(basecards, delimiter=',')
  line = 0
  versionNames = {}
  for row in csv_reader:
    if line == 0:
      for i in range(3, len(row)):
        versionNames[i] = row[i]
    elif line == 1:
        for i in range(3, len(row)):
            versionName = row[i]
            if versionName == "KICKSTARTER":
                versionNames[i] = "KS"
            elif versionName == "v2.0":
                # versionNames[i] is already set correctly (US, AU, etc)
                continue
            else:
                # Ignore any non-2.0 versions
                versionNames[i] = None
    else:
        parseCard(row, "base")
    line += 1

packs = {};

# Parse cards from the main expansion boxes (red, green, blue & absurd)
with open ("packs.csv", encoding="utf8") as packsCsv:
  csv_reader = csv.reader(packsCsv, delimiter=',')
  line = 0;
  curPack = ""
  for row in csv_reader:
    rowType = row[0]
    if rowType == "Set":
        curPack = row[2]
        packs[row[2]] = row[1]
        print(f"Found set '{row[1]}' (identified by '{row[2]}')")
    else:
        parseCard(row, curPack)
    line += 1

print(f"Parsed {str(len(blackCards))} black cards and {str(len(whiteCards))} white cards!")

# Convert the card objects into SQL

def getVersionsSQL(cardId, versions):
    versionsSQL = []
    for version in versions:
        versionsSQL.append(f"({cardId}, '{version}')")
    return versionsSQL

blackCardsSQL = []
blackCardsLinkSQL = []
cardId = 0

for blackCard in blackCards:
    blackCardsSQL.append(f"({cardId}, '{blackCard.pack}', '{blackCard.text}', {blackCard.draw}, {blackCard.pick})")
    if blackCard.pack == "base":
        versionsSQL = getVersionsSQL(cardId, blackCard.versions)
        if len(versionsSQL) > 0:
            blackCardsLinkSQL.append(", ".join(versionsSQL))
    cardId += 1

whiteCardsSQL = [];
whiteCardsLinkSQL = [];
cardId = 0

for whiteCard in whiteCards:
    whiteCardsSQL.append(f"({cardId}, '{whiteCard.pack}', '{whiteCard.text}')")
    if whiteCard.pack == "base":
        versionsSQL = getVersionsSQL(cardId, whiteCard.versions)
        if len(versionsSQL) > 0:
            whiteCardsLinkSQL.append(", ".join(versionsSQL))
    cardId += 1


packsSQL = []
packsJS = []

for packId, packName in packs.items():
    packsSQL.append(f"( '{packId}', '{packName}' )")
    packsJS.append(f'"{packId}"')

# Write the pack list to a temporary js file

packsFile = open("packs.js", "w", encoding="utf8")
packsFile.write("const packs = [ ")
packsFile.write(", ".join(packsJS))
packsFile.write(" ];")
packsFile.close()

def writeSQL(file, sql, values):
    file.write(sql)
    file.write(", ".join(values))
    file.write(";\n")

# Write the generated SQL to a file

output = open("generated.sql", "w", encoding="utf8")

writeSQL(output, "INSERT INTO packs (id, name) VALUES ", packsSQL)
writeSQL(output, "INSERT INTO black_cards (id, pack, text, draw, pick) VALUES ", blackCardsSQL)
writeSQL(output, "INSERT INTO black_cards_link (card_id, edition) VALUES ", blackCardsLinkSQL)
writeSQL(output, "INSERT INTO white_cards (id, pack, text) VALUES ", whiteCardsSQL)
writeSQL(output, "INSERT INTO white_cards_link (card_id, edition) VALUES ", whiteCardsLinkSQL)

output.close()
