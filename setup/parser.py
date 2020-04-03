import csv

# Data storage for parsed cards

class Card:
	def __init__(self, text, versions):
		self.text = text
		self.versions = versions

class BlackCard(Card):
	def __init__(self, text, versions, draw, pick):
		super().__init__(text, versions)
		self.draw = draw
		self.pick = pick

blackCards = []
whiteCards = []

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
    	text = row[1].replace("'", "\\'").replace("\n", "\\n")
    	versions = []
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
    		blackCards.append(BlackCard(text, versions, draw, pick))
    	else:
    		whiteCards.append(Card(text, versions))
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
	blackCardsSQL.append(f"({cardId}, 'base', '{blackCard.text}', {blackCard.draw}, {blackCard.pick})")
	versionsSQL = getVersionsSQL(cardId, blackCard.versions)
	if len(versionsSQL) > 0:
		blackCardsLinkSQL.append(", ".join(versionsSQL))
	cardId += 1

whiteCardsSQL = [];
whiteCardsLinkSQL = [];
cardId = 0

for whiteCard in whiteCards:
	whiteCardsSQL.append(f"({cardId}, 'base', '{whiteCard.text}')")
	versionsSQL = getVersionsSQL(cardId, whiteCard.versions)
	if len(versionsSQL) > 0:
		whiteCardsLinkSQL.append(", ".join(versionsSQL))
	cardId += 1

# Write the generated SQL to a file

output = open("generated.sql", "w")

output.write("USE `cah-online`;\n")

output.write("INSERT INTO black_cards (id, pack, text, draw, pick) VALUES ")
output.write(", ".join(blackCardsSQL))
output.write(";\n")

output.write("INSERT INTO black_cards_link (card_id, edition) VALUES ")
output.write(", ".join(blackCardsLinkSQL))
output.write(";\n")

output.write("INSERT INTO white_cards (id, pack, text) VALUES ")
output.write(", ".join(whiteCardsSQL))
output.write(";\n")

output.write("INSERT INTO white_cards_link (card_id, edition) VALUES ")
output.write(", ".join(whiteCardsLinkSQL))
output.write(";\n")