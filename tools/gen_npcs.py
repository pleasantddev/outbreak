#!/usr/bin/env python3
"""Builds v2/public/content/npcs.json. Edit here or edit the JSON directly (the admin panel does)."""
import json, sys
items = []

# ------------------------------------------------------------------ names
yo_m = "Adebayo Adewale Ayodele Babatunde Bamidele Bolaji Damilola Dayo Femi Gbenga Idowu Ife Kayode Kehinde Kolawole Kunle Lanre Niyi Olamide Olumide Olusegun Opeyemi Rotimi Sanmi Segun Seyi Sola Taiwo Tobi Tunde Wale Yemi Folarin Akin Dele Jide Tayo Toyin Bisi Sunday".split()
yo_f = "Abike Adeola Adunni Bimpe Bisola Bukola Damilola Folake Funke Funmilayo Kemi Lola Modupe Morenike Omolara Omotola Seun Shade Sade Titilayo Tolu Yetunde Yewande Ronke Toyin Wunmi Folasade Temitope Iyabo Ayo Bola Abosede Kudirat Risikat Sidikat Rukayat".split()
yo_s = "Adeyemi Adebisi Adeleke Ajayi Akinola Alabi Aluko Balogun Bankole Fashola Fasanya Ogunbanjo Ogunleye Ogundele Ogunsola Olaniyan Olatunji Oladipo Oladele Olawale Oyelaran Oyewole Salami Lawal Ojo Ola Taiwo Afolabi Adesina Adewumi Famuyiwa Onasanya Shonubi Sanusi Bello Raji Animashaun Oguntoye".split()
ig_m = "Chidi Chika Chinedu Chukwuemeka Emeka Ifeanyi Ikenna Kelechi Kenechukwu Nnamdi Obinna Obi Okechukwu Onyeka Uche Uchenna Somto Tochukwu Nonso Arinze Ugochukwu Chibuike Ebuka Ikechukwu Izuchukwu Munachi".split()
ig_f = "Adaeze Amaka Chioma Chinwe Ifeoma Ngozi Nneka Nkechi Obiageli Onyinye Uchechi Ugochi Uzoamaka Adanna Ebere Ijeoma Nkiru Oluchi Somkene Zuzu Chidinma Ogechi".split()
ig_s = "Okafor Okonkwo Nwosu Nwankwo Eze Obi Onwuka Umeh Anyanwu Ezeh Iwu Nnadi Ugwu Chukwu Okoye Okeke Madu Agu Ibe Ndukwe Ekwueme Nwachukwu Obiora Ogbonna Uzor".split()
ha_m = "Abdullahi Aminu Bashir Garba Hamza Ibrahim Idris Ismail Isa Jibril Kabiru Lawan Mansur Musa Mustapha Nasir Sani Shehu Suleiman Umar Usman Yakubu Yusuf Zubairu Auwal Danjuma".split()
ha_f = "Aisha Amina Fatima Halima Hauwa Hadiza Maryam Rabi Rakiya Safiya Salamatu Zainab Zulai Asma'u Binta Habiba Jamila Khadija Larai Sadiya".split()
ha_s = "Abubakar Adamu Bello Dantata Danladi Garba Gwarzo Haruna Ibrahim Kano Lawal Mohammed Muhammad Sambo Shuaibu Tijani Umar Yahaya Yusuf Zakari Dambazau".split()
ot_m = "Efe Osaze Etim Ime Tonye Ebi Ogheneovo Eyo Bassey Asuquo Edet Ovie Tamuno Ekene Ibiene Okon Idara Otobong Akpan Oghenekaro Ejiro".split()
ot_f = "Ese Osasu Mfon Nse Ibiere Ebiere Eno Idara Iyanu Ufuoma Ejiro Oghenetega Aniekan Itohan Imaobong Edirin Eseosa Utibe".split()
ot_s = "Okoro Ekpo Etim Bassey Edet Okon Akpan Asuquo Uduak Idemudia Ogbemudia Ighodaro Osagie Omoruyi Ikhide Ibeh Amadi Briggs Dickson Tamuno".split()
items += [
 dict(id="names.yoruba", kind="names", eth="yoruba", weight=55, faith=dict(christian=0.55, muslim=0.45), male=yo_m, female=yo_f, surnames=yo_s),
 dict(id="names.igbo", kind="names", eth="igbo", weight=20, faith=dict(christian=0.96, muslim=0.01), male=ig_m, female=ig_f, surnames=ig_s),
 dict(id="names.hausa", kind="names", eth="hausa", weight=11, faith=dict(christian=0.04, muslim=0.94), male=ha_m, female=ha_f, surnames=ha_s),
 dict(id="names.other", kind="names", eth="other", weight=14, faith=dict(christian=0.82, muslim=0.1), male=ot_m, female=ot_f, surnames=ot_s),
]

# ------------------------------------------------------------------ occupations
def occ(id, label, weight, wage, sites, wake, start, end, outdoor, age, female, rich, tales, role="ped", jitter=1.0, faction=None, vehicle=None, lunch=True, night=False, look=None, barks=None):
    d = dict(id="occ." + id, kind="occupation", label=label, weight=weight, role=role, wage="wage." + id, sites=sites,
             sched=dict(wake=wake, start=start, end=end, jitter=jitter, lunch=lunch, night=night, weekend="off" if id in ("bank_staff", "civil_servant", "teacher", "student", "mechanic") else "work"), outdoor=outdoor, age=age, female=female, rich=rich, tales=tales)
    if faction: d["faction"] = faction
    if vehicle: d["vehicle"] = vehicle
    if look: d["look"] = look
    if barks: d["barks"] = barks
    items.append(d)

occ("trader", "Market trader", 12, "wage.trader", ["market", "shops", "stand"], 5.5, 7.5, 18.5, 0.95, [24, 58], 0.35, [0.1, 0.55], faction="traders",
    tales=["{He} has had the same stall for {yrs} years and knows every customer by their face and their debt.", "{He} buys goods at Mile 12 before dawn and sells by afternoon, small margin, big hustle.", "{He} sells provisions and treats the neighbourhood like extended family, until you ask for credit."],
    barks=["Oga, come buy! Correct price!", "Fresh fresh! Today only!", "Customer, wetin you dey find?"], look=dict(top="tee", colors=["#8a0b0b", "#d9a441", "#355070"]))
occ("market_woman", "Market woman", 10, "wage.market_woman", ["market", "stand"], 5.0, 7.0, 17.5, 0.97, [28, 64], 1.0, [0.05, 0.5], faction="traders",
    tales=["{He} has sold tomatoes and pepper at the same spot since before the road was tarred.", "{He} pays association dues faithfully and will tell you the exact day the price of rice jumped.", "{He} raised {his} children from this table and wants one of them to study law."],
    barks=["Mummy mi, come buy tomato!", "Pepper dey cheap today!", "Make you no let anybody cheat you o."], look=dict(top="tee", pattern="ankara_wave", colors=["#d9a441", "#b0332a", "#355070"]))
occ("okada", "Okada rider", 8, "wage.okada", ["busStop", "street"], 5.5, 6.0, 21.0, 1.0, [19, 42], 0.02, [0.0, 0.3], faction="okada", vehicle="okada", lunch=False, jitter=1.5,
    tales=["{He} bought the bike on weekly instalments and still owes the financier more than {he} admits.", "{He} knows every shortcut from here to the expressway and every officer who collects at each one.", "{He} came to Lagos with nothing and the bike is the only thing {he} owns that works."],
    barks=["Oga, where you dey go? I carry you!", "Bike! Bike! Short trip!"], look=dict(top="tee", head="cap", colors=["#1e2b3a", "#5b1a16", "#2f4a2c"]))
occ("danfo_driver", "Danfo driver", 6, "wage.danfo", ["busStop"], 5.0, 5.5, 20.5, 1.0, [28, 60], 0.03, [0.0, 0.4], faction="union", vehicle="danfo", lunch=False,
    tales=["{He} has driven this route for {yrs} years, long enough to know which potholes are new.", "{He} pays the park chairman every morning before the first passenger boards.", "{He} owns the bus with a partner and they have not agreed on the maintenance bill since March."],
    look=dict(top="tee", pattern="stripe_danfo", colors=["#e8c34a"]))
occ("conductor", "Danfo conductor", 8, "wage.conductor", ["busStop"], 5.0, 5.5, 20.5, 1.0, [17, 38], 0.02, [0.0, 0.3], faction="union", lunch=False,
    tales=["{He} shouts the route from dawn and has lost {his} voice twice this year.", "{He} wants to drive one day, and is saving what the chairman does not collect.", "{He} fights for passengers at the park like it is a contact sport, because it is."],
    barks=["Oshodi Oshodi! Enter enter!", "Ojuelegba, Yaba, Obalende! Move!", "Chop change, no wahala! Enter!", "Last seat! Last seat!"], look=dict(top="tee", pattern="stripe_danfo", colors=["#e8c34a", "#141414"]))
occ("keke", "Keke rider", 5, "wage.keke", ["busStop", "street"], 5.5, 6.5, 20.5, 1.0, [22, 50], 0.02, [0.05, 0.35], faction="okada", vehicle="keke", lunch=False,
    tales=["{He} drives a rented keke and pays the owner before {he} pays {his} own landlord.", "{He} swears keke is safer than okada and quicker than danfo, depending on who is listening."], look=dict(top="tee", colors=["#e8c34a", "#355070"]))
occ("mechanic", "Mechanic", 5, "wage.mechanic", ["mechanic"], 6.0, 8.0, 18.5, 0.9, [22, 60], 0.03, [0.1, 0.5], faction=None,
    tales=["{He} learned under an oga for six years before opening {his} own bay.", "{He} can tell what is wrong with an engine by sound, and charges for the listening.", "{He} sells tokunbo parts and swears every one came off a clean car."],
    barks=["Oga, your car dey show me sign.", "Original part, no fake!", "Come, I go check am for you."], look=dict(top="tee", colors=["#3e3a33", "#355070", "#5b1a16"]))
occ("bank_staff", "Bank staff", 3, "wage.bank", ["bank"], 6.0, 8.0, 17.0, 0.12, [24, 52], 0.55, [0.45, 0.9], lunch=True, jitter=0.5,
    tales=["{He} counts other people's money all day and runs a salary advance by the 20th of every month.", "{He} took the job after a hundred rejections and now dreams of a transfer to Lekki branch."],
    look=dict(top="jacket", colors=["#1e2b3a", "#355070"]))
occ("police", "Police officer", 4, "wage.police", ["police", "street"], 6.0, 7.0, 19.0, 0.9, [22, 55], 0.12, [0.15, 0.6], role="police", faction="police", jitter=1.0,
    tales=["{He} joined for the stability and stays for the allowances that were never on the payslip.", "{He} has been posted to this division for {yrs} years and has not seen the promotion list.", "{He} wants to be a good officer and has been told this is not always compatible with being a paid one."],
    barks=["Oga, your particulars?", "Park well o.", "Wetin dey here?"])
occ("area_boy", "Area boy", 7, "wage.area_boy", ["street"], 11.0, 16.0, 29.0, 0.95, [17, 40], 0.02, [0.0, 0.25], role="area", faction="areaboys", lunch=False, night=True, jitter=1.5,
    tales=["{He} runs the corner and collects what {he} calls security fees from anybody who needs to park.", "{He} was somebody's apprentice once, and hands tell the story of how that ended.", "{He} does not start trouble, {he} says, {he} only finishes it."],
    barks=["Oga, na your own to settle us.", "Bring something for the boys.", "You dey lost?"])
occ("student", "Student", 9, "wage.student", ["school"], 6.0, 8.0, 15.0, 0.55, [12, 24], 0.5, [0.1, 0.8], lunch=True, jitter=0.6,
    tales=["{He} sits for WAEC soon and has learnt to study by phone torch when NEPA takes light.", "{He} dreams of a scholarship abroad and spends weekends on hustle to afford data."],
    barks=["Good morning sir!", "Oga, na exam time."], look=dict(top="tee", colors=["#c9c1b2", "#355070", "#e8e0d0"]))
occ("teacher", "Teacher", 3, "wage.teacher", ["school"], 5.5, 7.0, 15.5, 0.4, [24, 58], 0.62, [0.2, 0.65], jitter=0.5,
    tales=["{He} teaches {his} third set of final year students and has not been paid the allowance since last term.", "{He} runs lesson on weekends to survive the month."], look=dict(top="jacket", colors=["#5a3d2b", "#355070"]))
occ("civil_servant", "Civil servant", 4, "wage.civil", ["institution", "bank"], 6.0, 8.0, 16.0, 0.25, [26, 58], 0.5, [0.25, 0.75], jitter=0.6,
    tales=["{He} has been on grade level 8 for {yrs} years and knows which file will not move without a handshake.", "{He} works at the local government secretariat and keeps a side shop for the real money."], look=dict(top="jacket", colors=["#1e2b3a", "#6b6b6b"]))
occ("pastor", "Pastor", 1, "wage.pastor", ["church"], 5.0, 9.0, 20.0, 0.5, [30, 65], 0.2, [0.3, 0.85], faction="church", jitter=0.5, lunch=False,
    tales=["{He} started the church in a one room hall and now runs three services on Sunday.", "{He} prays for the sick, counsels the broke, and counts the offering with two deacons watching."], look=dict(top="jacket", colors=["#141414", "#355070"]))
occ("imam", "Imam", 1, "wage.imam", ["mosque"], 4.5, 9.0, 21.0, 0.5, [32, 70], 0.0, [0.2, 0.7], faction="mosque", jitter=0.5, lunch=False,
    tales=["{He} leads the five daily prayers and settles quarrels in the neighbourhood before they reach the police.", "{He} teaches Quran to the children after Asr and refuses payment."], look=dict(top="agbada", head="fila", colors=["#e8e0d0", "#c9c1b2"]))
occ("shop_owner", "Shop owner", 6, "wage.shop", ["shops", "stand"], 6.0, 8.0, 20.0, 0.9, [26, 60], 0.45, [0.3, 0.8], lunch=True,
    tales=["{He} opened the shop with a loan from the cooperative and pays it back one carton at a time.", "{He} stocks everything from recharge cards to cement and knows who is owing whom.", "{He} wants a second shop before the landlord raises the rent again."],
    barks=["Welcome, what you dey find?", "We get am o!"], look=dict(top="tee", colors=["#355070", "#2f4a2c"]))
occ("landlord", "Landlord", 2, "wage.landlord", ["street"], 6.0, 10.0, 17.0, 0.35, [38, 75], 0.3, [0.5, 1.0], lunch=True, jitter=1.0,
    tales=["{He} owns the compound and three others on the next street, and collects rent personally to avoid excuses.", "{He} inherited the land, built the flats on credit, and never forgave a late payment."], look=dict(top="agbada", colors=["#2f4a2c", "#5a3d2b", "#355070"]))
occ("hustler", "Hustler", 7, "wage.hustler", ["street"], 7.0, 9.0, 20.0, 1.0, [18, 45], 0.3, [0.0, 0.35], lunch=False, jitter=2.0,
    tales=["{He} does a bit of everything: recharge cards, phones, errands, small small business.", "{He} has three side hustles and a plan for a fourth.", "{He} knows somebody who knows somebody, and that is a fully working business model."],
    barks=["Oga, I fit get am for you.", "Wetin you need? I sabi person."])
occ("food_vendor", "Food vendor", 7, "wage.food_vendor", ["food", "street", "market"], 4.5, 6.5, 21.0, 1.0, [24, 62], 0.85, [0.05, 0.4], lunch=False,
    tales=["{He} runs a buka that is famous for beans and plantain, and infamous for slow service.", "{He} starts the pot at five and has sold out before three most days."],
    barks=["Rice and stew! Hot hot!", "Amala is ready!", "Buka open o!"], look=dict(top="tee", colors=["#b0332a", "#e8e0d0", "#d9a441"]))
occ("hawker", "Hawker", 6, "wage.hawker", ["busStop", "street"], 5.5, 6.5, 20.0, 1.0, [14, 40], 0.4, [0.0, 0.25], lunch=False, jitter=1.5,
    tales=["{He} sells sachet water, gala, and phone chargers to anybody stuck in traffic.", "{He} runs between cars with a tray on {his} head and has never been hit, so far."],
    barks=["Pure water! Cold cold!", "Gala! Gala! Gala!", "Charger! Original!"])
occ("guard", "Security guard", 5, "wage.guard", ["bank", "shops", "institution", "street"], 17.0, 18.0, 30.0, 0.9, [24, 58], 0.03, [0.0, 0.4], night=True, lunch=False,
    tales=["{He} works the night shift and sleeps through the afternoon, if the generator allows.", "{He} guards a gate for a salary smaller than what the gate is worth."], look=dict(top="tee", colors=["#141414", "#3e3a33"], head="cap"))
occ("nurse", "Nurse", 3, "wage.nurse", ["hospital"], 5.5, 7.0, 19.0, 0.2, [23, 55], 0.82, [0.2, 0.7], night=False,
    tales=["{He} works double shifts and has a plan to go abroad that {his} mother refuses to hear about.", "{He} patches up everybody who comes through the door and does not judge the stories."], look=dict(top="tee", colors=["#e8e0d0", "#c9c1b2"]))
occ("fuel_attendant", "Fuel attendant", 3, "wage.fuel_attendant", ["fuel"], 5.5, 6.5, 20.0, 1.0, [20, 45], 0.35, [0.0, 0.3],
    tales=["{He} knows the pump price before the board does, because customers complain first.", "{He} stands in the sun all day and makes peace between drivers in the queue."], look=dict(top="tee", colors=["#b0332a", "#e8e0d0"]))
occ("artisan", "Tailor or barber", 5, "wage.artisan", ["shops", "stand", "street"], 6.0, 8.5, 20.0, 0.9, [20, 55], 0.4, [0.1, 0.5],
    tales=["{He} cuts hair and stitches clothes in the same shop and does both better than the competition.", "{He} has two apprentices and no patience for either of them."], look=dict(top="tee", colors=["#8a0b0b", "#355070", "#e8e0d0"]))
occ("pos_agent", "POS agent", 4, "wage.pos", ["stand", "shops", "street"], 6.0, 7.5, 20.5, 1.0, [20, 40], 0.5, [0.1, 0.45],
    tales=["{He} runs a POS stand and knows exactly when the network will fail and charges extra anyway.", "{He} sits under an umbrella with a machine and a faithful queue."], barks=["Withdraw! Transfer! Quick!", "Network dey today o."], look=dict(top="tee", colors=["#355070", "#d9a441"]))
occ("unemployed", "Jobless", 5, "wage.unemployed", ["street"], 8.0, 12.0, 18.0, 1.0, [18, 45], 0.35, [0.0, 0.3], lunch=False, jitter=2.0,
    tales=["{He} has been between jobs for a while and has stopped calling it a break.", "{He} sends CVs on Monday and stands at the junction by Wednesday."])

# ------------------------------------------------------------------ factions
items += [
 dict(id="fac.areaboys", kind="faction", label="Area boys", ranks=["Omo ita", "Soldier", "Lieutenant", "Street boss", "Area chairman"], names=["{area} Boys", "{area} Elements", "Gbenga's Street, {area}"], cell="cell", levy=0.04),
 dict(id="fac.union", kind="faction", label="Transport union", ranks=["Member", "Conductor chief", "Park chairman", "Zone chairman", "Branch chairman"], names=["{area} Park Union", "{area} Transport Workers"], cell="site", siteKind="busStop", levy=0.05),
 dict(id="fac.okada", kind="faction", label="Okada association", ranks=["Rider", "Stand captain", "Stand chairman", "Zone coordinator"], names=["{area} Okada Riders", "{area} Keke Association"], cell="cell", levy=0.03),
 dict(id="fac.traders", kind="faction", label="Traders association", ranks=["Member", "Row leader", "Deputy Iyaloja", "Iyaloja or Babaloja"], names=["{area} Market Association", "{area} Traders Union"], cell="site", siteKind="market", levy=0.02),
 dict(id="fac.police", kind="faction", label="Police division", ranks=["Constable", "Corporal", "Sergeant", "Inspector", "Divisional officer"], names=["{area} Division", "{area} Police Station"], cell="site", siteKind="police", levy=0.0),
 dict(id="fac.church", kind="faction", label="Congregation", ranks=["Member", "Usher", "Elder", "Pastor"], names=["{area} Gospel Assembly", "{area} Faith Centre"], cell="site", siteKind="church", levy=0.1),
 dict(id="fac.mosque", kind="faction", label="Jamaa", ranks=["Member", "Muezzin", "Alfa", "Imam"], names=["{area} Central Mosque", "{area} Jamaa"], cell="site", siteKind="mosque", levy=0.025),
]

# ------------------------------------------------------------------ traits
def tr(id, label, ag, co, gr, lo, w, faith=0.0, vengeful=False):
    items.append(dict(id="trait." + id, kind="trait", label=label, aggression=ag, courage=co, greed=gr, loyalty=lo, faith=faith, vengeful=vengeful, weight=w))
tr("hothead", "Hot tempered", 0.35, 0.1, 0.0, -0.05, 8)
tr("calm", "Calm", -0.25, 0.05, -0.05, 0.1, 10)
tr("coward", "Cowardly", -0.2, -0.4, 0.05, -0.1, 6)
tr("brave", "Brave", 0.1, 0.4, -0.05, 0.1, 6)
tr("greedy", "Greedy", 0.05, 0.0, 0.4, -0.2, 9)
tr("generous", "Generous", -0.1, 0.05, -0.35, 0.2, 7)
tr("loyal", "Loyal", 0.0, 0.1, -0.1, 0.4, 8)
tr("slippery", "Slippery", 0.0, -0.05, 0.2, -0.4, 6)
tr("vengeful", "Never forgets", 0.1, 0.1, 0.0, 0.0, 6, vengeful=True)
tr("forgiving", "Forgives easily", -0.15, 0.0, -0.1, 0.1, 7)
tr("pious", "Devout", -0.1, 0.05, -0.15, 0.15, 8, faith=0.5)
tr("proud", "Proud", 0.2, 0.15, 0.05, 0.0, 7, vengeful=True)
tr("charming", "Charming", -0.05, 0.05, 0.05, 0.0, 6)
tr("stubborn", "Stubborn", 0.1, 0.2, 0.0, 0.1, 6, vengeful=True)

# ------------------------------------------------------------------ backstory parts
def bs(slot, text, occ=None, minAge=None, maxAge=None, eth=None):
    d = dict(id="bs.%s.%d" % (slot, sum(1 for i in items if i.get("kind") == "backstory" and i["slot"] == slot) + 1), kind="backstory", slot=slot, text=text)
    if occ: d["occ"] = ["occ." + o for o in occ]
    if minAge is not None: d["minAge"] = minAge
    if maxAge is not None: d["maxAge"] = maxAge
    if eth: d["eth"] = eth
    items.append(d)
bs("origin", "{Name} grew up in {area} and has never really left.")
bs("origin", "{Name} was born in {area}, the third of five children.")
bs("origin", "{Name} came to Lagos from {state} at nineteen with one bag and an uncle's phone number.")
bs("origin", "{Name} moved to {area} after the family land in {state} was sold under {his} father.")
bs("origin", "{Name} was raised by {his} grandmother in {area} while {his} parents worked abroad.")
bs("origin", "{Name} arrived from {state} during the rains and slept in a mechanic's workshop for the first month.", minAge=22)
bs("origin", "{Name} has lived on the same street in {area} since primary school.", minAge=18)
bs("origin", "{Name} is the first in {his} family to finish secondary school.", maxAge=32)
bs("origin", "{Name} is from {state} and speaks of home with equal parts longing and relief.", eth=["igbo", "hausa", "other"])
bs("origin", "{Name} was a child when {area} still had open drains and one working street light.", minAge=40)
bs("turn", "A fire took the family shop in 2019 and nobody was ever blamed.")
bs("turn", "{He} lost a brother to a police bullet at a checkpoint and does not talk about it.", minAge=20)
bs("turn", "{He} was scammed out of the school fees savings by a man who called himself a pastor.")
bs("turn", "{He} once went to jail for a weekend over a misunderstanding with an officer and has remembered every face since.", minAge=20)
bs("turn", "{He} got into a fight at fifteen that left {him} with a scar and a reputation.", maxAge=45)
bs("turn", "A flood took the room and everything in it, and {he} has kept receipts for everything since.")
bs("turn", "{He} was robbed at gunpoint on the way home and moved house within the month.", minAge=18)
bs("turn", "{He} lost a business partner who vanished with the money and the van.", minAge=25)
bs("turn", "{He} was beaten by a mob once for something {he} did not do, and has been wary of crowds since.")
bs("turn", "{He} won a small contract once, and the memory of what it paid keeps {him} chasing the next one.", minAge=24)
bs("turn", "{He} buried a parent last year and is still paying for the funeral.", minAge=22)
bs("ambition", "{He} wants to open a bigger place before the next Christmas.")
bs("ambition", "{He} is saving to leave Lagos and start again somewhere quiet.", minAge=25)
bs("ambition", "{He} wants to be respected on this street and has a plan for how.", occ=["area_boy", "hustler", "unemployed", "okada", "conductor"])
bs("ambition", "{He} wants {his} children to never do this kind of work.", minAge=28)
bs("ambition", "{He} is waiting for one good contract to change everything.")
bs("ambition", "{He} dreams of a visa and a flight, in that order.", maxAge=38)
bs("ambition", "{He} wants to own the land under {his} feet and trusts nobody with the papers.", minAge=30)
bs("ambition", "{He} is climbing and does not mind who is standing on the step above.", occ=["police", "civil_servant", "bank_staff", "area_boy", "conductor"])
bs("ambition", "{He} prays for peace and keeps a cutlass under the bed anyway.", minAge=30)
bs("ambition", "{He} wants to finish school, whatever it takes.", occ=["student", "hustler", "unemployed"])
bs("ambition", "{He} is tired and just wants the month to end with a little left over.", minAge=30)

# ------------------------------------------------------------------ taunts and lines (when -> lines)
def ta(when, lines, faction=None):
    d = dict(id="taunt.%s%s.%d" % (when, "." + faction if faction else "", sum(1 for i in items if i.get("kind") == "taunt" and i["when"] == when and i.get("faction") == faction) + 1), kind="taunt", when=when, lines=lines)
    if faction: d["faction"] = faction
    items.append(d)
ta("hurt", ["You remember me? {place}. You touched me there and thought it was finished.", "Ah ah! Na you. {place}, you carry hand for me. I no forget.", "I dey wait for you since {place}. Today na today."])
ta("hurt", ["{Name} still dey here. You thought I go forget {place}?", "You wan run again? Like {place}?"], "areaboys")
ta("robbed", ["You collect my money for {place}. Bring am back, or bring your head.", "Na you rob me! {place}! I get your face for my mind.", "My money wey you take for {place}? I never finish counting am."])
ta("carjacked", ["You carry my {item} for {place}! Where e dey?", "Oga, my {item}. {place}. You think say Lagos wide pass my memory?", "Na you steal my {item}! I never recover from that wahala."])
ta("carjacked", ["Thief! Thief! Na my {item} you take for {place}!", "Hold am! This one carry my {item} for {place}!"], "okada")
ta("beat_you", ["I put you down for {place} and now you dey walk for my street?", "Remember {place}? You were on the ground and I was standing. Make you no forget.", "They call me {rank} now. Na you help me reach there, after {place}."])
ta("survived", ["You thought you finish me for {place}. I still dey stand.", "I survive {place}. Look my face. Look am well.", "Na God save me for {place}. Now na your turn."])
ta("killed_kin", ["You kill my {rel} for {place}. I swear, one of us no go leave here.", "My {rel} dey for ground because of you, {place}. This one na family matter."])
ta("returned", ["You thought I die? {place} no fit finish me. I come back stronger.", "Dead man dey talk to you. {place}. Say your prayer.", "Look at me. You do this, {place}. I come back with friends."])
ta("betrayed", ["I trusted you and you sold me for small money. Never again.", "Na you spoil my name. I go spoil yours."])
ta("witnessed", ["I see wetin you do for {place}. I no go talk, but I no go forget.", "Please, abeg, no do me anything. I no tell anybody about {place}."])
ta("helped", ["Ah, my person! You remember me? {place}. I never forget your help.", "Na you help me for {place}. Anything you need, just call me.", "God go bless you for {place}. You get one person for this street."])
ta("tipped", ["Oga, the small money wey you drop for me for {place}, e save my week. Thank you.", "You be good person. I go carry your name for prayers."])
ta("met", ["Oga, I know you. Everybody for {area} don hear.", "You be the one from {place}? Na you.", "Hmm. See who come {area} today."])
ta("promoted", ["Na you make me {rank}. Remember dat.", "E no be small thing. {rank} {Name}, that is me now."])
ta("ambush", ["Una hold am! Na this one!", "We don find you. {place} no go save you.", "Today you go pay for {place}."])
ta("fear", ["Abeg, abeg, I no get anything.", "Oga please, I no do anything.", "Ah! Na you again! Please, I get family!"])
ta("ally_join", ["Oga, I dey with you! Make we handle these guys!", "Na my person dey inside wahala. Move!", "You no go fight alone! I reach!"])
ta("ally_greet", ["My guy! You dey alright?", "Na you be dat! Lagos small o.", "Oga, anything you need, I dey around."])
ta("ally_betray", ["I no wan do this, but I get my own matter. Sorry, my guy."])

# ------------------------------------------------------------------ city events
items += [
 dict(id="evt.robbery", kind="cityEvent", label="Street robbery", rate=0.9, days=[0, 0], news=["Robbery at {area}: {victim} lost {amount} to two men on a bike.", "Phone snatching spree around {area}, residents say it is getting worse.", "{area} traders lament after robbers took the day's takings."], toast="Robbery near you"),
 dict(id="evt.raid", kind="cityEvent", label="Police raid", rate=0.35, days=[0, 0], shock=None, news=["Police raid at {area}, {n} suspects picked up.", "Officers swept the {site} at {area} overnight. {n} arrests.", "{area} Division parades {n} suspected area boys."], site="bar", toast="Police raid close by"),
 dict(id="evt.union_fight", kind="cityEvent", label="Union clash", rate=0.25, days=[0, 0], news=["Two factions clashed at {area}. Traffic was stuck for hours.", "NURTW-style tussle at {area} park: {n} hurt, bus fares up.", "Park chairmen disagree at {area}, passengers stranded."], site="busStop", toast="Fight at the park"),
 dict(id="evt.market_fire", kind="cityEvent", label="Market fire", rate=0.06, days=[1, 3], shock="shock.market_fire", news=["Fire razes stalls at {area} market. Traders count their losses.", "Market fire at {area}: food prices jump as traders lose stock."], site="market", toast="Market on fire"),
 dict(id="evt.fuel_queue", kind="cityEvent", label="Fuel queue", rate=0.0, days=[2, 5], shock="shock.fuel_queue", news=["Long queues at filling stations as fuel scarcity bites.", "Petrol now sells for {price} per litre as supply tightens."], site="fuel", toast="Fuel scarcity"),
 dict(id="evt.okada_ban", kind="cityEvent", label="Okada ban", rate=0.0, days=[4, 9], shock="shock.okada_ban", news=["State government bans okada on major roads. Riders are lost.", "Okada ban begins. Keke and danfo fares go up.", "Riders protest the okada restriction at {area}."], toast="Okada ban"),
 dict(id="evt.rush", kind="cityEvent", label="Rush hour jam", rate=0.0, days=[0, 0], hours=[7, 9.5], news=["Heavy traffic on every major road. Leave home early or do not leave."], toast="Go slow"),
 dict(id="evt.strike", kind="cityEvent", label="Transport strike", rate=0.0, days=[1, 2], shock="shock.strike", news=["Transport workers down tools. Commuters walk to work.", "Strike at the parks: fares triple for those who find a bus."], toast="Transport strike"),
 dict(id="evt.blackout", kind="cityEvent", label="Blackout", rate=0.0, days=[1, 2], shock="shock.blackout", news=["Grid collapse. Generator sales rise, fuel too.", "Power cut across the corridor, fridge-sellers worried."], toast="Power cut"),
]

json.dump(dict(version=1, items=items), open(sys.argv[1] if len(sys.argv) > 1 else "/home/claude/wt/society/v2/public/content/npcs.json", "w"), indent=1, ensure_ascii=False)
print(len(items), "items")
