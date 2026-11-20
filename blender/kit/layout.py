"""Shared layout constants (three.js coordinates, metres, degrees). See docs/SCENE_CONTRACT.md."""
import math

# Curved stern: arc around centre (0, *, ARC_CZ), radius R. a=0 points straight back (-Z).
ARC_CZ = 1.0
R = 3.6
X_HALF = 3.0
Z_BACK = 2.6            # wall behind the visitor
CEIL = 3.0
A_END = math.degrees(math.asin(X_HALF / R))     # ~56.4 deg, where the arc meets the side walls
WIN_EDGES = [-30, -18, -6, 6, 18, 30]           # window post angles
SILL_Y, WIN_TOP, TRANSOM_Y = 0.95, 2.55, 2.15


def arc_pt(a_deg, r=R, y=0.0):
    a = math.radians(a_deg)
    return (r * math.sin(a), y, ARC_CZ - r * math.cos(a))


# Chart table
TABLE_C = (0.0, 0.85, -0.2)
TABLE_TOP = 0.85
TABLE_W, TABLE_D = 1.6, 1.1
MAP_Y = 0.852
MAP_W, MAP_D = 1.2, 0.8

# Chest + bookshelf unit (frame origin on the floor, centre of the chest footprint, local +Z = front)
CHEST_A = -42.0
CHEST_POS = arc_pt(CHEST_A, R - 0.33)
CHEST_YAW = -CHEST_A

# Logbook rack (frame origin on floor under the board, at the wall; local +Z = front)
RACK_A = 43.0
RACK_POS = arc_pt(RACK_A, R - 0.03)
RACK_YAW = -RACK_A
RACK_CY = 1.55

# Wheel
WHEEL_C = (0.0, 1.1, -1.9)

# Props on the table
LANTERN_POS = (-0.55, MAP_Y, -0.08)
COMPASS_POS = (0.5, TABLE_TOP, -0.13)     # fix round: clear of the logbook (was z 0.1)
SPYGLASS_POS = (0.42, TABLE_TOP, -0.38)

# Handheld (group origin = body centre)
HH_PITCH = -25.0                 # leans back; screen faces up/toward the visitor
HH_W, HH_H, HH_T = 0.224, 0.104, 0.03
HH_SCREEN_W, HH_SCREEN_H = 0.12, 0.0675
HH_SCREEN_Y = 0.004              # screen centre offset (local y)
HH_POS = (0.0, 0.0, 0.12)        # y filled in by handheld.py so it rests on the map

SKY_ANCHOR = (0.0, 1.5, -6.0)
