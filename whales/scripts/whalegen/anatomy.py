"""v2 anatomy: species-true part definitions (all lengths are fractions of body length L).

trunk rows : (t, half_width, height_top, height_bottom, center_z, superellipse_n)
             for t < hinge the trunk is the skull/rostrum; its underside sits on the lower jaw.
jaw rows   : (t, half_width, lip_height, depth, z_top) - lower jaw loft (an asymmetric ellipse whose top
             is the mouth line z_top; lip_height = how far the lower lip rises above it, depth = below it).
features   : analytic SDF primitives added (smooth-union) or carved (smooth-subtract).
fin        : pectoral flipper planform + attachment.  fluke : planform.
References (research notes in PLAN_v2.md): NOAA, FAO species ID sheets, Sea Watch Foundation, Mammal Society,
SeaWorld, Duke SEAMAP, Wikipedia.
"""

ANATOMY = {
    # ------------------------------------------------------------------ blue whale
    # broad flat U-shaped rostrum, short median ridge, big splashguard, lower jaw bowing out wider than the
    # upper jaw, gently curved mouthline, eye just above/behind the corner, small dorsal far back,
    # slender pointed flippers (~14% L), broad fluke (~26% L) with shallow notch, pleats to the navel.
    'blue': dict(
        hinge=0.205,
        trunk=[
            (0.000, 0.000, 0.000, 0.000, -0.012, 2.2),
            (0.008, 0.016, 0.008, 0.005, -0.012, 2.2),
            (0.040, 0.040, 0.015, 0.007, -0.010, 2.5),
            (0.090, 0.056, 0.021, 0.009, -0.008, 2.6),
            (0.150, 0.067, 0.031, 0.013, -0.006, 2.5),
            (0.200, 0.074, 0.046, 0.034, -0.004, 2.3),
            (0.250, 0.079, 0.058, 0.064, -0.004, 2.1),
            (0.380, 0.082, 0.070, 0.074, 0.000, 2.1),
            (0.550, 0.072, 0.062, 0.064, 0.002, 2.1),
            (0.700, 0.050, 0.050, 0.046, 0.004, 2.1),
            (0.820, 0.026, 0.037, 0.032, 0.004, 2.4),
            (0.920, 0.012, 0.026, 0.022, 0.003, 2.8),
            (1.000, 0.007, 0.013, 0.011, 0.002, 2.8),
        ],
        jaw=[
            (-0.010, 0.004, 0.002, 0.004, -0.019),
            (0.004, 0.022, 0.004, 0.014, -0.019),
            (0.040, 0.046, 0.006, 0.030, -0.018),
            (0.100, 0.066, 0.007, 0.046, -0.016),
            (0.160, 0.078, 0.007, 0.058, -0.013),
            (0.205, 0.081, 0.005, 0.064, -0.010),
            (0.250, 0.076, 0.002, 0.060, -0.008),
        ],
        mouth_end=0.200, mouth_rise=0.004,
        eye=dict(t=0.212, up=0.010, r=0.0058),
        features=[
            ('ellipsoid', dict(t=0.168, x=0.0, z='top', r=(0.030, 0.026, 0.011), k=0.012)),          # splashguard
            ('ridge', dict(t0=0.015, t1=0.160, r=0.0035, h=0.002, k=0.006)),                          # short median ridge
            ('blowholes', dict(t=0.172, sep=0.008, r=0.004)),
        ],
        dorsal=dict(t=0.76, h=0.012, base=0.030, rake=0.6),
        fin=dict(t=0.265, th=0.70, len=0.145, chord=0.036, droop=34, sweep=20, curve=12, tip_up=0,
                 shape='slender', scallops=0, thick=0.20),
        fluke=dict(span=0.26, chord=0.052, sweep=0.30, notch=0.30, te='concave', tip=1.6, serr=0),
        pleats=dict(t0=0.01, t1=0.50, n=80),
        blow=0.172,
    ),
    # ------------------------------------------------------------------ sperm whale
    # enormous square head ~1/3 L with blunt front (spermaceti organ), narrow rod-like lower jaw set back under
    # the head (mouth on the underside, white lips), S-shaped blowhole front-left, eye far back above the
    # jaw angle, dorsal hump at 2/3 + knuckles, prune-wrinkled skin, short rounded paddle flippers,
    # very wide triangular fluke with straight trailing edges and a deep notch.
    'sperm': dict(
        hinge=0.31,
        trunk=[
            (0.000, 0.000, 0.000, 0.000, 0.020, 3.0),
            (0.004, 0.054, 0.082, 0.052, 0.020, 3.4),
            (0.020, 0.074, 0.102, 0.068, 0.018, 3.8),
            (0.120, 0.082, 0.110, 0.074, 0.014, 3.7),
            (0.250, 0.086, 0.104, 0.080, 0.008, 3.6),
            (0.330, 0.086, 0.090, 0.084, 0.002, 2.6),
            (0.450, 0.083, 0.080, 0.082, 0.000, 2.2),
            (0.600, 0.070, 0.068, 0.066, 0.003, 2.2),
            (0.720, 0.052, 0.054, 0.048, 0.005, 2.2),
            (0.840, 0.028, 0.038, 0.034, 0.005, 2.5),
            (0.930, 0.014, 0.026, 0.022, 0.003, 2.9),
            (1.000, 0.009, 0.014, 0.012, 0.002, 2.9),
        ],
        jaw=[
            (0.050, 0.006, 0.006, 0.006, -0.050),
            (0.080, 0.011, 0.007, 0.010, -0.053),
            (0.160, 0.015, 0.007, 0.012, -0.058),
            (0.240, 0.020, 0.007, 0.014, -0.062),
            (0.310, 0.026, 0.006, 0.016, -0.066),
            (0.350, 0.030, 0.003, 0.018, -0.070),
        ],
        mouth_end=0.31, mouth_rise=0.0,
        eye=dict(t=0.318, up=0.020, r=0.0055),
        features=[
            ('ellipsoid', dict(t=0.64, x=0.0, z='top', r=(0.020, 0.040, 0.012), k=0.015)),         # dorsal hump
            ('knuckles', dict(t0=0.70, t1=0.84, n=5, r=0.0065, k=0.006)),
            ('slit', dict(t=0.010, x=-0.025, len=0.020, r=0.0028)),                                  # blowhole
        ],
        dorsal=None,
        fin=dict(t=0.345, th=0.76, len=0.095, chord=0.040, droop=36, sweep=18, curve=6, tip_up=0,
                 shape='paddle', scallops=0, thick=0.26),
        fluke=dict(span=0.28, chord=0.070, sweep=0.22, notch=0.60, te='straight', tip=1.2, serr=0),
        wrinkles=True, white_lips=True,
        blow=0.010,
    ),
    # ------------------------------------------------------------------ beluga
    # bulbous melon, short broad beak with lips and upturned smile, visible neck crease, eye above the corner,
    # dorsal ridge (no fin), small broad paddle flippers with upcurled tips, fluke with convex trailing edge.
    'beluga': dict(
        hinge=0.085,
        trunk=[
            (0.000, 0.000, 0.000, 0.000, -0.012, 2.0),
            (0.010, 0.020, 0.014, 0.010, -0.012, 2.0),
            (0.030, 0.036, 0.026, 0.016, -0.010, 2.0),
            (0.055, 0.058, 0.060, 0.030, -0.004, 2.0),
            (0.090, 0.088, 0.088, 0.060, -0.002, 2.0),
            (0.130, 0.096, 0.084, 0.086, -0.004, 2.0),
            (0.165, 0.092, 0.078, 0.088, -0.006, 2.0),
            (0.220, 0.108, 0.098, 0.102, -0.002, 2.0),
            (0.340, 0.120, 0.112, 0.114, 0.000, 2.0),
            (0.500, 0.116, 0.108, 0.106, 0.002, 2.0),
            (0.640, 0.088, 0.088, 0.076, 0.006, 2.1),
            (0.780, 0.050, 0.060, 0.046, 0.006, 2.3),
            (0.900, 0.022, 0.034, 0.026, 0.004, 2.7),
            (1.000, 0.011, 0.016, 0.012, 0.002, 2.9),
        ],
        jaw=[
            (-0.004, 0.006, 0.004, 0.006, -0.025),
            (0.010, 0.022, 0.008, 0.018, -0.025),
            (0.040, 0.040, 0.010, 0.032, -0.024),
            (0.075, 0.056, 0.010, 0.046, -0.020),
            (0.100, 0.066, 0.006, 0.058, -0.016),
        ],
        mouth_end=0.082, mouth_rise=0.010, crease=0.0028,
        eye=dict(t=0.097, up=0.016, r=0.0062),
        features=[
            ('ellipsoid', dict(t=0.075, x=0.0, z=0.035, r=(0.064, 0.058, 0.052), k=0.035)),         # melon
            ('ring', dict(t=0.165, depth=0.004, w=0.012)),                                          # neck crease
            ('ridge', dict(t0=0.46, t1=0.72, r=0.006, h=0.003, k=0.010)),                           # dorsal ridge
        ],
        dorsal=None,
        fin=dict(t=0.215, th=0.74, len=0.105, chord=0.050, droop=34, sweep=16, curve=4, tip_up=24,
                 shape='paddle', scallops=0, thick=0.24),
        fluke=dict(span=0.23, chord=0.058, sweep=0.20, notch=0.30, te='convex', tip=1.0, serr=0),
        blow=0.070,
    ),
    # ------------------------------------------------------------------ humpback
    # flat rostrum with knob rows (tubercles), knobs on the lower lip + chin knob, protruding lower jaw, long
    # white flippers ~1/3 L with scalloped leading edge, small dorsal on a hump, big fluke with serrated edge.
    'humpback': dict(
        hinge=0.21,
        trunk=[
            (0.000, 0.000, 0.000, 0.000, -0.013, 2.2),
            (0.010, 0.022, 0.008, 0.005, -0.013, 2.2),
            (0.050, 0.046, 0.014, 0.007, -0.012, 2.5),
            (0.100, 0.064, 0.021, 0.009, -0.010, 2.6),
            (0.160, 0.077, 0.032, 0.014, -0.008, 2.5),
            (0.210, 0.088, 0.058, 0.040, -0.004, 2.2),
            (0.270, 0.098, 0.082, 0.086, -0.002, 2.1),
            (0.400, 0.102, 0.094, 0.094, 0.000, 2.0),
            (0.550, 0.090, 0.084, 0.080, 0.004, 2.0),
            (0.680, 0.064, 0.070, 0.056, 0.006, 2.1),
            (0.800, 0.034, 0.048, 0.040, 0.006, 2.5),
            (0.910, 0.016, 0.030, 0.024, 0.004, 2.8),
            (1.000, 0.009, 0.016, 0.012, 0.002, 2.9),
        ],
        jaw=[
            (-0.014, 0.005, 0.003, 0.006, -0.021),
            (0.004, 0.026, 0.005, 0.018, -0.021),
            (0.050, 0.054, 0.007, 0.040, -0.020),
            (0.110, 0.074, 0.008, 0.058, -0.018),
            (0.170, 0.088, 0.008, 0.070, -0.014),
            (0.210, 0.094, 0.006, 0.076, -0.010),
            (0.260, 0.090, 0.002, 0.070, -0.008),
        ],
        mouth_end=0.205, mouth_rise=0.004,
        eye=dict(t=0.218, up=0.011, r=0.0058),
        features=[
            ('tubercles', dict(t0=0.015, t1=0.17, rows=3, n=8, r=0.0042, k=0.004, where='rostrum')),
            ('tubercles', dict(t0=0.005, t1=0.16, rows=1, n=7, r=0.0040, k=0.004, where='lip')),
            ('ellipsoid', dict(t=-0.004, x=0.0, z='chin', r=(0.010, 0.010, 0.009), k=0.006)),       # chin knob
            ('ellipsoid', dict(t=0.66, x=0.0, z='top', r=(0.018, 0.045, 0.010), k=0.015)),          # hump
            ('blowholes', dict(t=0.182, sep=0.008, r=0.004)),
        ],
        dorsal=dict(t=0.675, h=0.010, base=0.026, rake=0.3),
        fin=dict(t=0.250, th=0.70, len=0.310, chord=0.044, droop=36, sweep=18, curve=20, tip_up=0,
                 shape='humpback', scallops=10, thick=0.20),
        fluke=dict(span=0.31, chord=0.062, sweep=0.30, notch=0.35, te='serrated', tip=1.5, serr=1),
        pleats=dict(t0=0.01, t1=0.47, n=26),
        blow=0.182,
    ),
    # ------------------------------------------------------------------ bowhead
    # head ~1/3 L, strongly bowed mouthline, arched narrow upper jaw, huge lower lips forming the head side,
    # blowhole bulge with a dip behind it, eye just above the mouth corner, white chin patch with dark spots,
    # no dorsal fin, short broad blunt paddle flippers, very wide fluke with pointed tips, white peduncle band.
    'bowhead': dict(
        hinge=0.300,
        trunk=[
            (0.000, 0.000, 0.000, 0.000, 0.010, 2.2),
            (0.010, 0.010, 0.014, 0.006, 0.012, 2.2),
            (0.050, 0.020, 0.040, 0.010, 0.018, 2.2),
            (0.100, 0.027, 0.064, 0.012, 0.024, 2.2),
            (0.160, 0.034, 0.080, 0.014, 0.026, 2.2),
            (0.215, 0.060, 0.088, 0.040, 0.018, 2.1),
            (0.265, 0.092, 0.076, 0.090, 0.002, 2.0),
            (0.360, 0.112, 0.098, 0.106, -0.002, 2.0),
            (0.500, 0.110, 0.104, 0.100, 0.000, 2.0),
            (0.640, 0.088, 0.088, 0.075, 0.004, 2.0),
            (0.780, 0.052, 0.058, 0.046, 0.006, 2.3),
            (0.900, 0.022, 0.030, 0.024, 0.004, 2.8),
            (1.000, 0.010, 0.015, 0.012, 0.002, 2.9),
        ],
        jaw=[
            (0.004, 0.010, 0.006, 0.012, 0.004),
            (0.030, 0.030, 0.024, 0.030, 0.008),
            (0.080, 0.052, 0.050, 0.054, 0.012),
            (0.150, 0.074, 0.062, 0.078, 0.012),
            (0.220, 0.090, 0.054, 0.096, 0.004),
            (0.290, 0.098, 0.024, 0.104, -0.008),
            (0.330, 0.096, 0.006, 0.098, -0.010),
        ],
        mouth_end=0.295, mouth_rise=0.0, bowed=0.05,
        eye=dict(t=0.305, up=0.010, r=0.0060),
        features=[
            ('ellipsoid', dict(t=0.205, x=0.0, z='top', r=(0.030, 0.034, 0.016), k=0.018)),         # blowhole bulge
            ('blowholes', dict(t=0.205, sep=0.009, r=0.0045)),
        ],
        dorsal=None,
        fin=dict(t=0.325, th=0.74, len=0.125, chord=0.054, droop=36, sweep=16, curve=6, tip_up=0,
                 shape='paddle', scallops=0, thick=0.24),
        fluke=dict(span=0.33, chord=0.058, sweep=0.34, notch=0.30, te='concave', tip=1.8, serr=0),
        chin_patch=True, peduncle_band=True,
        blow=0.205,
    ),
    # ------------------------------------------------------------------ minke
    # narrow pointed triangular rostrum with a single sharp median ridge, mouthline curving up behind the eye,
    # tall falcate dorsal at ~2/3, slim pointed flippers (~12% L) with a white band, pointed fluke.
    'minke': dict(
        hinge=0.178,
        trunk=[
            (0.000, 0.000, 0.000, 0.000, -0.007, 2.2),
            (0.010, 0.010, 0.007, 0.004, -0.007, 2.2),
            (0.040, 0.026, 0.013, 0.006, -0.007, 2.4),
            (0.090, 0.041, 0.021, 0.008, -0.006, 2.5),
            (0.140, 0.053, 0.031, 0.012, -0.004, 2.5),
            (0.180, 0.061, 0.046, 0.034, -0.002, 2.3),
            (0.240, 0.068, 0.060, 0.060, 0.000, 2.1),
            (0.360, 0.074, 0.066, 0.066, 0.000, 2.1),
            (0.520, 0.068, 0.062, 0.058, 0.002, 2.1),
            (0.660, 0.050, 0.050, 0.042, 0.004, 2.1),
            (0.800, 0.026, 0.037, 0.030, 0.004, 2.5),
            (0.910, 0.013, 0.024, 0.019, 0.003, 2.8),
            (1.000, 0.008, 0.013, 0.010, 0.002, 2.9),
        ],
        jaw=[
            (-0.008, 0.003, 0.002, 0.004, -0.012),
            (0.006, 0.014, 0.004, 0.010, -0.012),
            (0.040, 0.030, 0.005, 0.024, -0.012),
            (0.100, 0.048, 0.006, 0.038, -0.011),
            (0.150, 0.060, 0.006, 0.048, -0.009),
            (0.180, 0.064, 0.004, 0.054, -0.006),
            (0.220, 0.064, 0.002, 0.052, -0.004),
        ],
        mouth_end=0.172, mouth_rise=0.010,
        eye=dict(t=0.186, up=0.009, r=0.0058),
        features=[
            ('ridge', dict(t0=0.008, t1=0.150, r=0.0028, h=0.003, k=0.004)),
            ('ellipsoid', dict(t=0.158, x=0.0, z='top', r=(0.016, 0.018, 0.006), k=0.008)),          # small splashguard
            ('blowholes', dict(t=0.160, sep=0.006, r=0.003)),
        ],
        dorsal=dict(t=0.665, h=0.030, base=0.030, rake=1.0),
        fin=dict(t=0.262, th=0.70, len=0.125, chord=0.030, droop=34, sweep=20, curve=10, tip_up=0,
                 shape='slender', scallops=0, thick=0.20),
        fluke=dict(span=0.24, chord=0.046, sweep=0.32, notch=0.40, te='concave', tip=1.8, serr=0),
        pleats=dict(t0=0.01, t1=0.34, n=60), flipper_band=True,
        blow=0.160,
    ),
}
