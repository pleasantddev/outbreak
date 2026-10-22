#!/usr/bin/env python3
"""Builds v2/public/content/economy.json. Naira, per game day (a game day is 48 real minutes)."""
import json, sys
items = []
def good(id, label, unit, base, el, per, ticker=True):
    items.append(dict(id="good." + id, kind="good", label=label, unit=unit, base=base, elasticity=el, perDay=per, ticker=ticker))
good("fuel", "Petrol", "litre", 1050, 0.55, 3.2)
good("plate", "Plate of jollof", "plate", 2500, 0.4, 1.0)
good("bread", "Bread", "loaf", 1800, 0.35, 0.35)
good("rice", "Rice, 50kg", "bag", 98000, 0.45, 0.03)
good("fare_danfo", "Danfo fare", "trip", 300, 0.3, 1.1)
good("fare_okada", "Okada fare", "trip", 800, 0.35, 0.5)
good("fare_keke", "Keke fare", "trip", 500, 0.3, 0.4)
good("parts", "Brake pads, set", "set", 32000, 0.3, 0.004)
good("data", "Data, 1GB", "GB", 700, 0.2, 0.6, False)

def wage(id, label, daily, spread=0.25, link=None):
    d = dict(id="wage." + id, kind="wage", label=label, daily=daily, spread=spread)
    if link: d["link"] = "good." + link
    items.append(d)
wage("trader", "Market trader", 8500, 0.35, "bread")
wage("market_woman", "Market woman", 7200, 0.3, "rice")
wage("okada", "Okada rider", 11500, 0.3, "fare_okada")
wage("danfo", "Danfo driver", 16000, 0.25, "fare_danfo")
wage("conductor", "Conductor", 7000, 0.3, "fare_danfo")
wage("keke", "Keke rider", 10000, 0.3, "fare_keke")
wage("mechanic", "Mechanic", 9500, 0.35, "parts")
wage("bank", "Bank staff", 11000, 0.1)
wage("police", "Police officer", 3800, 0.1)
wage("area_boy", "Area boy", 5500, 0.6)
wage("student", "Student allowance", 1200, 0.3)
wage("teacher", "Teacher", 5600, 0.1)
wage("civil", "Civil servant", 5200, 0.1)
wage("pastor", "Pastor", 9000, 0.4)
wage("imam", "Imam", 6000, 0.3)
wage("shop", "Shop owner", 14000, 0.4, "bread")
wage("landlord", "Landlord", 3000, 0.2)
wage("hustler", "Hustler", 4200, 0.6)
wage("food_vendor", "Food vendor", 7500, 0.35, "plate")
wage("hawker", "Hawker", 3800, 0.4)
wage("guard", "Security guard", 3200, 0.08)
wage("nurse", "Nurse", 6200, 0.1)
wage("fuel_attendant", "Fuel attendant", 3900, 0.1)
wage("artisan", "Tailor or barber", 6800, 0.4)
wage("pos", "POS agent", 6400, 0.4, "data")
wage("unemployed", "Odd jobs", 1500, 0.8)

items.append(dict(id="rent.room", kind="rent", label="One room, per year", poor=190000, rich=1700000))
items += [
 dict(id="sink.tithe", kind="sink", label="Tithe and zakat", rate=0.09),
 dict(id="sink.levy", kind="sink", label="Street levy (area boys, unions, markets)", rate=0.04),
 dict(id="sink.bribe", kind="sink", label="Settlement to officers", rate=0.015),
 dict(id="sink.crime", kind="sink", label="Daily robbery hazard at poverty 1.0", rate=0.035),
]
items += [
 dict(id="shock.market_fire", kind="shock", label="Market fire", mult={"good.bread": 1.12, "good.plate": 1.1, "good.rice": 1.08}),
 dict(id="shock.fuel_queue", kind="shock", label="Fuel scarcity", mult={"good.fuel": 1.42, "good.fare_danfo": 1.15, "good.fare_okada": 1.22, "good.fare_keke": 1.18}),
 dict(id="shock.okada_ban", kind="shock", label="Okada ban", mult={"good.fare_okada": 1.0, "good.fare_keke": 1.3, "good.fare_danfo": 1.12}),
 dict(id="shock.strike", kind="shock", label="Transport strike", mult={"good.fare_danfo": 2.3, "good.fare_okada": 1.5, "good.fare_keke": 1.5}),
 dict(id="shock.blackout", kind="shock", label="Grid collapse", mult={"good.fuel": 1.15, "good.data": 1.2, "good.bread": 1.05}),
]
items.append(dict(id="macro.main", kind="macro", inflationPerYear=0.22, dayPerYear=90))
json.dump(dict(version=1, items=items), open(sys.argv[1] if len(sys.argv) > 1 else "/home/claude/wt/society/v2/public/content/economy.json", "w"), indent=1, ensure_ascii=False)
print(len(items), "items")
