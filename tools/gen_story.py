#!/usr/bin/env python3
"""Story mode: "Last Stop, Oshodi". Six chapters written as ordinary missions (category "story") so they run on the
mission engine like everything else, show on the map and in Hustles, and work offline and online.

Run from the repo root:  python3 tools/gen_story.py
It replaces every category "story" item in v2/public/content/missions.json and leaves the rest alone.

Choices carry between chapters as flags (story_*), and the Story app (v2/src/systems/story.ts) reads them back for the
recap and the ending. Player-facing text: Lagos voice, light pidgin, no em dashes. Crime stays satire, never a how-to.
"""
import json, pathlib

ARC = 'Last Stop, Oshodi'
F = pathlib.Path(__file__).resolve().parent.parent / 'v2/public/content/missions.json'


def L(*pairs):
    return [list(p) for p in pairs]


chapters = []

# ---------------------------------------------------------------------------------------------------- 1
chapters.append({
    'id': 'story_01', 'title': 'Last Stop, Oshodi', 'arc': ARC, 'category': 'story', 'area': 'Oshodi',
    'giver': 'Mama Titi', 'minutes': 8, 'difficulty': 1,
    'blurb': 'Your cousin Kunle was meant to meet you at the park. He did not come. Mama Titi at the buka knows everybody.',
    'offer': {'board': True, 'giver': {'name': 'Mama Titi', 'at': 'mama_put_oshodi', 'look': 'vendor',
              'line': 'You be Kunle cousin? Come and sit down, my pikin. We need to talk.'}},
    'start': 'titi',
    'steps': [
        {'id': 'titi', 'type': 'talk', 'npc': 'Mama Titi', 'to': 'mama_put_oshodi', 'look': 'vendor', 'text': 'Talk to Mama Titi at the buka',
         'lines': L(['Mama Titi', 'So you be the cousin from Ibadan. Kunle talk about you every day.'],
                    ['Mama Titi', 'Two weeks now, nobody see am. Some men dey come here dey ask for am. Not friendly men.'],
                    ['Mama Titi', 'Go check im shop for Computer Village. Shine your eye.'])},
        {'id': 'go_cv', 'type': 'goto', 'to': 'computer_village', 'text': "Find Kunle's shop in Computer Village"},
        {'id': 'emeka', 'type': 'talk', 'npc': 'Emeka', 'to': 'computer_village_alley', 'look': 'ped', 'text': "Ask Kunle's shop neighbour",
         'lines': L(['Emeka', 'Kunle? E don lock shop since. Men from one Alhaji Kasumu come carry im generator and im stock.'],
                    ['Emeka', 'Before e run, e drop this note for you. Say make I give only you.'])},
        {'id': 'note', 'type': 'pickup', 'to': 'computer_village_alley', 'item': "Kunle's note", 'text': "Take Kunle's note"},
        {'id': 'ring', 'type': 'call', 'who': 'Kunle', 'line': 'Na me. No talk my name for that place.', 'answer': 'end', 'decline': 'end',
         'text': 'Your phone is ringing',
         'lines': L(['Kunle', 'Last year I help Alhaji Kasumu sell one plot for Ayobo. Commission work, small money.'],
                    ['Kunle', 'Na later I find out e don sell that same land to four other people. When they come shout, e put am for my head.'],
                    ['Kunle', 'Now e say I owe am two and half million naira. Make you no come find me. Find work, find your feet. I go call you.'])},
        {'id': 'end', 'type': 'end', 'outcome': 'win', 'title': 'CHAPTER 1 DONE'},
    ],
    'rewards': {'cash': 8000, 'xp': 120, 'skillXp': {'street': 10}, 'setFlag': ['story_ch1']},
    'fail': {'onDeath': True}, 'tags': ['story'],
})

# ---------------------------------------------------------------------------------------------------- 2
chapters.append({
    'id': 'story_02', 'title': 'Shine Your Eye', 'arc': ARC, 'category': 'story', 'area': 'Oshodi',
    'giver': 'Sule the conductor', 'minutes': 12, 'difficulty': 2,
    'blurb': 'Sule needs a driver for one run to Ikeja. Under the bridge, Baba Ibeji collects what he calls dues.',
    'req': {'after': ['story_01']},
    'offer': {'board': True, 'call': {'who': 'Sule the conductor', 'weight': 9,
              'line': 'Kunle cousin? Mama Titi say you need work. I get bus wey no get driver. Come Oshodi park sharp sharp.'}},
    'start': 'sule',
    'steps': [
        {'id': 'sule', 'type': 'talk', 'npc': 'Sule', 'to': 'oshodi_park', 'look': 'ped', 'text': 'Meet Sule at Oshodi park',
         'lines': L(['Sule', 'Na this yellow bus. Oshodi to Ikeja, collect your fare, bring the bus back. Simple.'],
                    ['Sule', 'One thing. When you reach under the bridge, Baba Ibeji boys go stop you. Na Lagos, no fight dem if you fit.'])},
        {'id': 'bus', 'type': 'vehicle', 'kind': ['danfo'], 'provide': 'oshodi_park', 'text': 'Get in the danfo'},
        {'id': 'run', 'type': 'route', 'route': 'danfo_oshodi_ikeja', 'text': 'Run the Oshodi to Ikeja line'},
        {'id': 'back', 'type': 'goto', 'to': 'oshodi_underbridge', 'on': 'vehicle', 'text': 'Bring the bus back under the bridge'},
        {'id': 'dues', 'type': 'choice', 'who': "Baba Ibeji's boys",
         'prompt': '"Morning dues. Loading, ticket, union, chairman birthday, chairman wife birthday. Six thousand."',
         'options': [
             {'text': 'Pay ₦6,000 and keep moving', 'next': 'end_paid', 'fx': {'cash': -6000, 'setFlag': ['story_dues_paid'], 'rep': {'union': 4}}},
             {'text': '"Chairman wife birthday was last month."', 'next': 'end_talk',
              'roll': {'skill': 'charm', 'dc': 3, 'ok': 'end_talk', 'bad': 'brawl', 'okFx': {'setFlag': ['story_dues_talked']}}},
             {'text': 'Refuse. You earned this money.', 'next': 'brawl', 'fx': {'setFlag': ['story_dues_fought']}},
         ]},
        {'id': 'brawl', 'type': 'fight', 'at': 'oshodi_underbridge', 'foes': [{'n': 2, 'role': 'area', 'weapon': 'fists'}],
         'text': "Deal with Baba Ibeji's boys", 'fx': {'setFlag': ['story_dues_fought']}},
        {'id': 'end_fought', 'type': 'end', 'outcome': 'win', 'title': 'CHAPTER 2 DONE',
         'rewards': {'cash': 14000, 'xp': 200, 'skillXp': {'drive': 24, 'fight': 18}, 'rep': {'union': -8, 'streets': 6}, 'setFlag': ['story_ch2']}},
        {'id': 'end_paid', 'type': 'end', 'outcome': 'win', 'title': 'CHAPTER 2 DONE',
         'rewards': {'cash': 14000, 'xp': 180, 'skillXp': {'drive': 24}, 'rep': {'union': 4}, 'setFlag': ['story_ch2']}},
        {'id': 'end_talk', 'type': 'end', 'outcome': 'win', 'title': 'CHAPTER 2 DONE',
         'rewards': {'cash': 14000, 'xp': 200, 'skillXp': {'drive': 24, 'charm': 20}, 'rep': {'union': 2, 'streets': 3}, 'setFlag': ['story_ch2']}},
    ],
    'rewards': {'cash': 14000, 'xp': 180, 'setFlag': ['story_ch2']},
    'fail': {'onDeath': True, 'timer': 1200}, 'tags': ['story'],
})

# ---------------------------------------------------------------------------------------------------- 3
chapters.append({
    'id': 'story_03', 'title': 'Phone Wey Get Mouth', 'arc': ARC, 'category': 'story', 'area': 'Ikeja',
    'giver': 'Kunle', 'minutes': 10, 'difficulty': 2,
    'blurb': "Kunle surfaces. His old phone holds voice notes of Kasumu selling the same plot again and again. Somebody else wants it too.",
    'req': {'after': ['story_02']},
    'offer': {'board': True, 'call': {'who': 'Kunle', 'weight': 9,
              'line': 'I hear you dey drive bus now. Good. Meet me for the back of Computer Village. Come alone.'}},
    'start': 'kunle',
    'steps': [
        {'id': 'kunle', 'type': 'talk', 'npc': 'Kunle', 'to': 'computer_village_alley', 'look': 'ped', 'text': 'Meet Kunle behind Computer Village',
         'lines': L(['Kunle', 'Cousin. Look at you. Lagos never finish you yet.'],
                    ['Kunle', 'This old phone get voice notes. Kasumu dey sell the same plot to different people, im own voice, im own mouth.'],
                    ['Kunle', 'Keep am. If them catch me, at least the truth go still dey somewhere.'])},
        {'id': 'take', 'type': 'pickup', 'to': 'computer_village_alley', 'item': "Kunle's old phone", 'text': 'Take the phone'},
        {'id': 'snatch', 'type': 'chase', 'from': 'computer_village_alley', 'npc': "Kasumu's runner", 'caughtR': 2.4, 'escapeD': 140,
         'text': 'A boy snatched the phone. Catch him', 'fx': {'takeItem': ["Kunle's old phone"]},
         'say': L(['Kunle', 'Hey! Na Kasumu boy be that! Run am down!'])},
        {'id': 'back', 'type': 'pickup', 'to': 'computer_village_alley', 'item': "Kunle's old phone", 'text': 'The boy dropped it. Pick up the phone'},
        {'id': 'unlock', 'type': 'hack', 'label': "Unlock Kunle's phone", 'len': 6, 'secs': 30, 'onFail': 'emeka',
         'text': 'The screen is cracked and locked. Get it open'},
        {'id': 'saved', 'type': 'end', 'outcome': 'win', 'title': 'CHAPTER 3 DONE',
         'rewards': {'cash': 10000, 'xp': 220, 'skillXp': {'hack': 30, 'stamina': 12}, 'setFlag': ['story_ch3', 'story_has_recording']}},
        {'id': 'emeka', 'type': 'tap', 'label': 'Emeka forces the back open. Hold the screen steady', 'taps': 14, 'secs': 9, 'perTap': 1,
         'text': 'Let Emeka open it the old way', 'onFail': 'lost'},
        {'id': 'old_way', 'type': 'end', 'outcome': 'win', 'title': 'CHAPTER 3 DONE',
         'rewards': {'cash': 6000, 'xp': 200, 'skillXp': {'stamina': 16}, 'setFlag': ['story_ch3', 'story_has_recording']}},
        {'id': 'lost', 'type': 'end', 'outcome': 'win', 'title': 'CHAPTER 3 DONE',
         'text': 'The phone died in your hands. Kunle will have to find another way.',
         'rewards': {'xp': 160, 'setFlag': ['story_ch3']}},
    ],
    'rewards': {'cash': 10000, 'xp': 220, 'setFlag': ['story_ch3']},
    'fail': {'onDeath': True}, 'tags': ['story'],
})
# the step after 'emeka' succeeds is the next one in the list: point it at the right end
chapters[-1]['steps'][6]['next'] = 'old_way'

# ---------------------------------------------------------------------------------------------------- 4
chapters.append({
    'id': 'story_04', 'title': 'Ladipo Before Dark', 'arc': ARC, 'category': 'story', 'area': 'Mushin',
    'giver': 'Oga Chidi', 'minutes': 13, 'difficulty': 3,
    'blurb': "Kunle's debt will not pay itself. Oga Chidi in Ladipo pays well for parts that reach Cappa before the shops close.",
    'req': {'after': ['story_03']},
    'offer': {'board': True, 'giver': {'name': 'Oga Chidi', 'at': 'ladipo_gate', 'look': 'vendor',
              'line': 'Kunle say you sabi drive. These parts must reach Cappa before dark. I pay sixty thousand.'}},
    'start': 'chidi',
    'steps': [
        {'id': 'chidi', 'type': 'talk', 'npc': 'Oga Chidi', 'to': 'ladipo_gate', 'look': 'vendor', 'text': 'Talk to Oga Chidi',
         'lines': L(['Oga Chidi', 'Gearbox, two alternators, one radiator. Original parts, not Taiwan.'],
                    ['Oga Chidi', 'Baba Ade for Cappa dey wait. If e close shop before you reach, na my money you waste.'])},
        {'id': 'car', 'type': 'vehicle', 'kind': ['hatch', 'sedan', 'suv', 'jeep'], 'provide': 'ladipo_gate', 'text': 'Find a car with a boot'},
        {'id': 'load', 'type': 'pickup', 'to': 'ladipo_stall_row', 'item': 'gearbox parts', 'text': 'Load the parts at the stall row'},
        {'id': 'which', 'type': 'branch', 'cases': [{'if': {'flag': 'story_dues_fought'}, 'next': 'block'}], 'else': 'drive'},
        {'id': 'block', 'type': 'goto', 'to': 'papa_ajao', 'on': 'vehicle', 'text': 'Head through Papa Ajao',
         'say': L(['Sule', 'Omo, Baba Ibeji boys don hear say na you beat dem for Oshodi. Dem dey wait for Papa Ajao. Careful!'])},
        {'id': 'ambush', 'type': 'fight', 'at': 'papa_ajao', 'foes': [{'n': 3, 'role': 'area', 'weapon': 'fists'}], 'text': 'Baba Ibeji wants his dues back',
         'next': 'drive'},
        {'id': 'drive', 'type': 'goto', 'to': 'cappa_village', 'on': 'vehicle', 'text': 'Get the parts to Cappa before dark', 'timer': 420, 'onTimeout': 'late'},
        {'id': 'drop', 'type': 'deliver', 'to': 'cappa_village', 'item': 'gearbox parts', 'npc': 'Baba Ade', 'text': 'Hand the parts to Baba Ade'},
        {'id': 'paid', 'type': 'end', 'outcome': 'win', 'title': 'CHAPTER 4 DONE',
         'rewards': {'cash': 60000, 'xp': 260, 'skillXp': {'drive': 40, 'mech': 10}, 'rep': {'mechanics': 8}, 'setFlag': ['story_ch4']}},
        {'id': 'late', 'type': 'deliver', 'to': 'cappa_village', 'item': 'gearbox parts', 'npc': 'Baba Ade', 'text': 'You are late. Deliver anyway',
         'say': L(['Oga Chidi', 'Ehn, you dey drive like person wey dey find wife. Deliver am, I go remove something.'])},
        {'id': 'paid_less', 'type': 'end', 'outcome': 'win', 'title': 'CHAPTER 4 DONE',
         'rewards': {'cash': 35000, 'xp': 200, 'skillXp': {'drive': 30}, 'rep': {'mechanics': 3}, 'setFlag': ['story_ch4']}},
    ],
    'rewards': {'cash': 60000, 'xp': 260, 'setFlag': ['story_ch4']},
    'fail': {'onDeath': True}, 'tags': ['story'],
})

# ---------------------------------------------------------------------------------------------------- 5
chapters.append({
    'id': 'story_05', 'title': 'Paper Pass Power', 'arc': ARC, 'category': 'story', 'area': 'Alausa',
    'giver': 'Barrister Ronke', 'minutes': 14, 'difficulty': 3,
    'blurb': "A lawyer who has beaten Kasumu before. She needs the plot's survey plan, and somebody to stand on the land while it is pegged.",
    'req': {'after': ['story_04']},
    'offer': {'board': True, 'call': {'who': 'Barrister Ronke', 'weight': 9,
              'line': 'Kunle gave me your number. In Lagos, the person with the paper wins. Meet me at Alausa.'}},
    'start': 'ronke',
    'steps': [
        {'id': 'ronke', 'type': 'talk', 'npc': 'Barrister Ronke', 'to': 'alausa_secretariat', 'look': 'ped', 'text': 'Meet Barrister Ronke at Alausa',
         'lines': L(['Barrister Ronke', 'Kasumu has sold that Ayobo plot five times. Nobody has a survey plan, because he never registered it.'],
                    ['Barrister Ronke', 'We register it in the real owner\'s name, then we peg it. Get the survey plan from the clerk next door.'])},
        {'id': 'office', 'type': 'goto', 'to': 'alausa_surveyor', 'text': "Go to the surveyor's office"},
        {'id': 'clerk', 'type': 'trade', 'at': 'alausa_surveyor', 'npc': 'Survey clerk', 'haggle': True,
         'buy': {'item': 'survey plan', 'price': 25000, 'label': 'Survey plan, stamped'}, 'onBroke': 'short', 'onWalk': 'short',
         'text': 'Get the survey plan from the clerk'},
        {'id': 'peg', 'type': 'goto', 'to': 'ayobo_plot', 'text': 'Take the plan to the plot in Ayobo'},
        {'id': 'hold', 'type': 'fight', 'at': 'ayobo_plot', 'hold': 45, 'foes': [{'n': 3, 'role': 'area', 'weapon': 'fists'}],
         'text': 'Keep the land grabbers off while the surveyor pegs the corners',
         'say': L(['Surveyor', 'Four beacons. Give me forty five seconds. Do not let them pull anything out.'])},
        {'id': 'done', 'type': 'end', 'outcome': 'win', 'title': 'CHAPTER 5 DONE',
         'rewards': {'cash': 20000, 'xp': 300, 'skillXp': {'fight': 20, 'trade': 16}, 'rep': {'church': 6, 'landlords': -6}, 'setFlag': ['story_ch5']}},
        {'id': 'short', 'type': 'choice', 'who': 'Survey clerk', 'prompt': '"No money, no plan. Next."',
         'options': [{'text': 'Come back with the money', 'next': 'clerk'},
                     {'text': 'Call Barrister Ronke', 'next': 'office', 'fx': {'cash': 25000, 'say': [['Barrister Ronke', 'I sent it. Pay me back when Kasumu pays everybody back.']]}}]},
    ],
    'rewards': {'cash': 20000, 'xp': 300, 'setFlag': ['story_ch5']},
    'fail': {'onDeath': True}, 'tags': ['story'],
})

# ---------------------------------------------------------------------------------------------------- 6
chapters.append({
    'id': 'story_06', 'title': 'Owambe for Ikeja GRA', 'arc': ARC, 'category': 'story', 'area': 'Ikeja',
    'giver': 'Kunle', 'minutes': 12, 'difficulty': 4,
    'blurb': 'Kasumu throws a party in GRA to sell the plot one last time. You have the paper, maybe the voice notes, and one chance.',
    'req': {'after': ['story_05']},
    'offer': {'board': True, 'call': {'who': 'Kunle', 'weight': 9,
              'line': 'Kasumu dey do owambe for GRA tonight. Na there e wan sell the land again. We go end am there.'}},
    'start': 'go',
    'steps': [
        {'id': 'go', 'type': 'goto', 'to': 'ikeja_gra', 'text': "Get to Kasumu's owambe in Ikeja GRA"},
        {'id': 'meet', 'type': 'talk', 'npc': 'Alhaji Kasumu', 'to': 'ikeja_gra', 'look': 'area', 'text': 'Find Alhaji Kasumu',
         'lines': L(['Alhaji Kasumu', 'Ah, Kunle people. Welcome, chop rice. Land is like jollof. Everybody wants a plate.'],
                    ['Alhaji Kasumu', 'I hear you get one phone. And one paper from Alausa. You are a busy somebody.'])},
        {'id': 'offer', 'type': 'choice', 'who': 'Alhaji Kasumu',
         'prompt': '"Let us be friends. Four hundred thousand, cash, tonight. Forget Ayobo, forget Kunle debt."',
         'options': [
             {'text': 'Take the voice notes to the police', 'next': 'police', 'if': {'flag': 'story_has_recording'}, 'lockedHint': 'You need the voice notes from Chapter 3'},
             {'text': 'Take the money. Debt gone, everybody happy.', 'next': 'deal'},
             {'text': 'Wave the survey plan in front of his guests', 'next': 'shame',
              'roll': {'skill': 'charm', 'dc': 4, 'ok': 'shame', 'bad': 'brawl'}},
         ]},
        {'id': 'police', 'type': 'goto', 'to': 'ikeja_police_hq', 'text': 'Get to Ikeja police headquarters'},
        {'id': 'dauda', 'type': 'talk', 'npc': 'Inspector Dauda', 'to': 'ikeja_police_hq', 'look': 'police', 'text': 'Play the voice notes to Inspector Dauda',
         'lines': L(['Inspector Dauda', 'Same plot, five buyers, one voice. Even my oga cannot argue with this one.'],
                    ['Inspector Dauda', 'We will invite Alhaji for a chat. A long chat.'])},
        {'id': 'end_justice', 'type': 'end', 'outcome': 'win', 'title': 'PAPER AND VOICE',
         'rewards': {'cash': 150000, 'xp': 600, 'rep': {'police': 10, 'church': 10, 'landlords': -10}, 'setFlag': ['story_ch6', 'story_done', 'story_end_justice']}},
        {'id': 'deal', 'type': 'end', 'outcome': 'win', 'title': 'EVERYBODY HAPPY',
         'rewards': {'cash': 400000, 'xp': 450, 'rep': {'streets': 8, 'church': -8}, 'setFlag': ['story_ch6', 'story_done', 'story_end_deal']}},
        {'id': 'shame', 'type': 'end', 'outcome': 'win', 'title': 'OWAMBE SCATTER',
         'rewards': {'cash': 100000, 'xp': 550, 'skillXp': {'charm': 40}, 'rep': {'church': 12, 'landlords': -12}, 'setFlag': ['story_ch6', 'story_done', 'story_end_shame']}},
        {'id': 'brawl', 'type': 'fight', 'at': 'ikeja_gra', 'foes': [{'n': 4, 'role': 'area', 'weapon': 'fists'}], 'text': "Kasumu's boys want the plan. Keep it",
         'say': L(['Alhaji Kasumu', 'Collect that paper from am!'])},
        {'id': 'end_streets', 'type': 'end', 'outcome': 'win', 'title': 'STREET JUSTICE',
         'rewards': {'cash': 80000, 'xp': 520, 'skillXp': {'fight': 40}, 'rep': {'streets': 12, 'police': -4}, 'setFlag': ['story_ch6', 'story_done', 'story_end_streets']}},
    ],
    'rewards': {'cash': 100000, 'xp': 500, 'setFlag': ['story_ch6', 'story_done']},
    'fail': {'onDeath': True}, 'tags': ['story'],
})

doc = json.loads(F.read_text())
items = [m for m in doc['items'] if m.get('category') != 'story'] + chapters
doc['items'] = items
F.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + '\n')
print(f'{len(chapters)} story chapters written; {len(items)} missions in total')
