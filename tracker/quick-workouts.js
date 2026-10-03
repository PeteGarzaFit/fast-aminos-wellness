// RENOVO workout library: quick workouts clients can start any day, filtered by time, body part and gym/home.
// Items use the same shape as plan items. ss groups supersets/circuits; rest "none" means go straight to the next move.
window.QUICK_WORKOUTS = [
 {
  "id": "arm-blast",
  "name": "Sleeve Stretcher",
  "min": 30,
  "focus": "Arms",
  "where": "gym",
  "level": "All levels",
  "equip": [
   "Dumbbells",
   "Incline bench",
   "Flat bench",
   "Cable with rope"
  ],
  "desc": "A biceps-and-triceps giant set for 4 rounds (heavy slow reps, then light pump reps), then 100 pushdowns and 100 hammer curls. Pete's own arm day.",
  "items": [
   {
    "name": "Incline Neutral DB Curl",
    "sets": "4",
    "reps": "6",
    "rest": "none",
    "note": "Palms facing each other. Slow 4-second lowering. Go straight to A2.",
    "ref": "arms",
    "ss": "A",
    "tempo": "4/0/1/0"
   },
   {
    "name": "DB Spider Curl",
    "sets": "4",
    "reps": "15",
    "rest": "none",
    "note": "Chest on an incline bench, arms hanging straight down. Go straight to A3.",
    "ref": "arms",
    "ss": "A"
   },
   {
    "name": "Flat Bench DB Skull Crusher",
    "sets": "4",
    "reps": "6",
    "rest": "none",
    "note": "Lower the dumbbells slowly beside your head. Go straight to A4.",
    "ref": "arms",
    "ss": "A",
    "tempo": "4/0/1/0"
   },
   {
    "name": "Seated DB Overhead Triceps Extension",
    "sets": "4",
    "reps": "15",
    "rest": "90 sec",
    "note": "Then rest 90 seconds and start the next round at A1.",
    "ref": "arms",
    "ss": "A"
   },
   {
    "name": "Cable Rope Triceps Pushdown",
    "sets": "1",
    "reps": "100",
    "rest": "",
    "note": "100 total reps in as few sets as you can. Log each mini-set with + Add a set.",
    "ref": "arms",
    "ss": "B"
   },
   {
    "name": "Cable Rope Hammer Curl",
    "sets": "1",
    "reps": "100",
    "rest": "",
    "note": "100 total reps in as few sets as you can. Log each mini-set with + Add a set.",
    "ref": "arms",
    "ss": "C"
   }
  ]
 },
 {
  "id": "arm-blast-home",
  "name": "Sleeve Stretcher: Home",
  "min": 25,
  "focus": "Arms",
  "where": "home",
  "level": "All levels",
  "desc": "Dumbbells and a chair. Two supersets and a push-up burnout.",
  "items": [
   {
    "name": "Biceps Curl",
    "sets": "3",
    "reps": "10–15",
    "rest": "none",
    "note": "Superset A.",
    "ref": "arms/home",
    "ss": "A"
   },
   {
    "name": "Chair Dip",
    "sets": "3",
    "reps": "10–15",
    "rest": "60 sec",
    "note": "",
    "ref": "arms/home",
    "ss": "A"
   },
   {
    "name": "Hammer Curl",
    "sets": "3",
    "reps": "12",
    "rest": "none",
    "note": "Superset B.",
    "ref": "arms/home",
    "ss": "B"
   },
   {
    "name": "Triceps Kickback",
    "sets": "3",
    "reps": "12–15",
    "rest": "60 sec",
    "note": "",
    "ref": "arms/home",
    "ss": "B"
   },
   {
    "name": "Close-Grip Push-Up",
    "sets": "2",
    "reps": "Near failure",
    "rest": "60 sec",
    "note": "Finisher. Drop to your knees when you need to.",
    "ref": "arms/home"
   }
  ]
 },
 {
  "id": "upper-pump",
  "name": "Upper Body Pump",
  "min": 30,
  "focus": "Upper body",
  "where": "gym",
  "level": "All levels",
  "desc": "Push-pull supersets for chest, back and shoulders in 30 minutes.",
  "items": [
   {
    "name": "Incline Dumbbell Press",
    "sets": "3",
    "reps": "8–12",
    "rest": "none",
    "note": "Superset A.",
    "ref": "chest",
    "ss": "A"
   },
   {
    "name": "Single-Arm Dumbbell Row",
    "sets": "3",
    "reps": "10–12 per arm",
    "rest": "90 sec",
    "note": "",
    "ref": "back",
    "ss": "A"
   },
   {
    "name": "Seated Dumbbell Shoulder Press",
    "sets": "3",
    "reps": "8–12",
    "rest": "none",
    "note": "Superset B.",
    "ref": "shoulders",
    "ss": "B"
   },
   {
    "name": "Lat Pulldown or Pull-Up",
    "sets": "3",
    "reps": "8–12",
    "rest": "90 sec",
    "note": "",
    "ref": "back",
    "ss": "B"
   },
   {
    "name": "Dumbbell Lateral Raise",
    "sets": "3",
    "reps": "12–15",
    "rest": "none",
    "note": "Superset C.",
    "ref": "shoulders",
    "ss": "C"
   },
   {
    "name": "Face Pull",
    "sets": "3",
    "reps": "15",
    "rest": "60 sec",
    "note": "",
    "ref": "back",
    "ss": "C"
   }
  ]
 },
 {
  "id": "chest-tri",
  "name": "Chest & Triceps",
  "min": 45,
  "focus": "Chest",
  "where": "gym",
  "level": "Intermediate",
  "desc": "Heavy press first, then volume for the upper chest and triceps.",
  "items": [
   {
    "name": "Barbell or Dumbbell Bench Press",
    "sets": "4",
    "reps": "6–10",
    "rest": "2 min",
    "note": "",
    "ref": "chest"
   },
   {
    "name": "Incline Dumbbell Press",
    "sets": "3",
    "reps": "8–12",
    "rest": "90 sec",
    "note": "",
    "ref": "chest"
   },
   {
    "name": "Cable or Dumbbell Fly",
    "sets": "3",
    "reps": "12–15",
    "rest": "60 sec",
    "note": "",
    "ref": "chest"
   },
   {
    "name": "Machine or Weighted Dip",
    "sets": "3",
    "reps": "8–12",
    "rest": "90 sec",
    "note": "",
    "ref": "chest"
   },
   {
    "name": "Triceps Pushdown",
    "sets": "3",
    "reps": "12–15",
    "rest": "60 sec",
    "note": "",
    "ref": "arms"
   }
  ]
 },
 {
  "id": "back-bi",
  "name": "Back & Biceps",
  "min": 45,
  "focus": "Back",
  "where": "gym",
  "level": "Intermediate",
  "desc": "Width and thickness: pulldowns, rows, then curls.",
  "items": [
   {
    "name": "Pull-Up or Lat Pulldown",
    "sets": "4",
    "reps": "6–10",
    "rest": "2 min",
    "note": "",
    "ref": "back"
   },
   {
    "name": "Barbell or Dumbbell Row",
    "sets": "4",
    "reps": "8–10",
    "rest": "2 min",
    "note": "",
    "ref": "back"
   },
   {
    "name": "Seated Cable Row",
    "sets": "3",
    "reps": "10–12",
    "rest": "90 sec",
    "note": "",
    "ref": "back"
   },
   {
    "name": "Face Pull",
    "sets": "3",
    "reps": "15",
    "rest": "60 sec",
    "note": "",
    "ref": "back"
   },
   {
    "name": "EZ-Bar Curl",
    "sets": "3",
    "reps": "10–12",
    "rest": "60 sec",
    "note": "",
    "ref": "arms"
   },
   {
    "name": "Hammer Curl",
    "sets": "2",
    "reps": "12",
    "rest": "60 sec",
    "note": "",
    "ref": "arms"
   }
  ]
 },
 {
  "id": "boulder-shoulders",
  "name": "Boulder Shoulders",
  "min": 40,
  "focus": "Shoulders",
  "where": "gym",
  "level": "Intermediate",
  "equip": [
   "Plate-loaded shoulder press",
   "Cable with straight bar",
   "Dumbbells",
   "Incline bench",
   "Flat bench",
   "Lateral raise machine"
  ],
  "desc": "Pete's shoulder day: a heavy press, then side, rear and side delts again until they're on fire. Finishes with 10 sets of 10.",
  "items": [
   {
    "name": "Hammer Strength Seated Shoulder Press",
    "sets": "5",
    "reps": "15/12/10/10/10",
    "rest": "2 min",
    "note": "Add weight as the reps drop. No machine? Seated dumbbell press.",
    "ref": "shoulders",
    "ss": "A",
    "tempo": "3/0/1/0"
   },
   {
    "name": "Straight Bar Wide Cable Upright Row",
    "sets": "4",
    "reps": "15",
    "rest": "60 sec",
    "note": "Wide grip, pull to chest height, elbows lead. Squeeze 1 second at the top.",
    "ref": "shoulders",
    "ss": "B",
    "tempo": "2/0/1/1"
   },
   {
    "name": "Lying Incline DB Lateral Raise",
    "sets": "4",
    "reps": "12",
    "rest": "none",
    "note": "Lie on your side on an incline bench, raise one arm at a time. Go straight to C2.",
    "ref": "shoulders",
    "ss": "C"
   },
   {
    "name": "Standing DB Side Lateral Raise",
    "sets": "4",
    "reps": "20",
    "rest": "60 sec",
    "note": "Lighter dumbbells, constant tension.",
    "ref": "shoulders",
    "ss": "C"
   },
   {
    "name": "Seated Rear Delt Fly",
    "sets": "4",
    "reps": "15",
    "rest": "60 sec",
    "note": "Chest on your thighs or a bench. Pause 1 second at the top.",
    "ref": "shoulders",
    "ss": "D",
    "tempo": "2/1/2/0"
   },
   {
    "name": "Standing Side Lateral Raise Machine",
    "sets": "10",
    "reps": "10",
    "rest": "30 sec",
    "note": "10 sets of 10 with just 30 seconds of rest. Pick a weight you can finish all 10 sets with. No machine? Cable or dumbbell lateral raises.",
    "ref": "shoulders",
    "ss": "E"
   }
  ]
 },
 {
  "id": "shoulders",
  "name": "Shoulder Sculpt",
  "min": 30,
  "focus": "Shoulders",
  "where": "gym",
  "level": "All levels",
  "desc": "Press, then a lateral and rear delt superset for round shoulders.",
  "items": [
   {
    "name": "Seated Dumbbell Shoulder Press",
    "sets": "4",
    "reps": "8–10",
    "rest": "2 min",
    "note": "",
    "ref": "shoulders"
   },
   {
    "name": "Dumbbell Lateral Raise",
    "sets": "3",
    "reps": "12–15",
    "rest": "none",
    "note": "Superset A.",
    "ref": "shoulders",
    "ss": "A"
   },
   {
    "name": "Rear Delt Fly",
    "sets": "3",
    "reps": "12–15",
    "rest": "60 sec",
    "note": "",
    "ref": "shoulders",
    "ss": "A"
   },
   {
    "name": "Face Pull",
    "sets": "3",
    "reps": "15",
    "rest": "60 sec",
    "note": "",
    "ref": "back"
   },
   {
    "name": "Dumbbell Shrug",
    "sets": "3",
    "reps": "12–15",
    "rest": "60 sec",
    "note": "",
    "ref": "shoulders"
   }
  ]
 },
 {
  "id": "legs",
  "name": "Leg Day",
  "min": 60,
  "focus": "Legs",
  "where": "gym",
  "level": "Intermediate",
  "desc": "Squat, hinge, press, lunge. The full lower-body session.",
  "items": [
   {
    "name": "Back Squat or Goblet Squat",
    "sets": "4",
    "reps": "6–10",
    "rest": "3 min",
    "note": "Brace hard, full depth you control.",
    "ref": "legs"
   },
   {
    "name": "Romanian Deadlift",
    "sets": "3",
    "reps": "8–10",
    "rest": "2 min",
    "note": "",
    "ref": "legs"
   },
   {
    "name": "Leg Press",
    "sets": "3",
    "reps": "10–12",
    "rest": "2 min",
    "note": "",
    "ref": "legs"
   },
   {
    "name": "Walking Lunge",
    "sets": "3",
    "reps": "10 per leg",
    "rest": "90 sec",
    "note": "",
    "ref": "legs"
   },
   {
    "name": "Lying or Seated Leg Curl",
    "sets": "3",
    "reps": "10–12",
    "rest": "60 sec",
    "note": "",
    "ref": "legs"
   },
   {
    "name": "Standing Calf Raise",
    "sets": "4",
    "reps": "12–15",
    "rest": "60 sec",
    "note": "",
    "ref": "legs"
   }
  ]
 },
 {
  "id": "glutes",
  "name": "Glute Builder",
  "min": 40,
  "focus": "Glutes",
  "where": "gym",
  "level": "All levels",
  "desc": "Hip thrusts heavy, then single-leg work and a burnout.",
  "items": [
   {
    "name": "Barbell Hip Thrust",
    "sets": "4",
    "reps": "8–12",
    "rest": "2 min",
    "note": "Pause one second at the top.",
    "ref": "glutes"
   },
   {
    "name": "Bulgarian Split Squat",
    "sets": "3",
    "reps": "8–10 per leg",
    "rest": "90 sec",
    "note": "",
    "ref": "glutes"
   },
   {
    "name": "Romanian Deadlift",
    "sets": "3",
    "reps": "10",
    "rest": "90 sec",
    "note": "",
    "ref": "legs"
   },
   {
    "name": "Cable Kickback",
    "sets": "3",
    "reps": "12–15 per leg",
    "rest": "45 sec",
    "note": "",
    "ref": "glutes"
   },
   {
    "name": "Hip Abduction Machine or Banded Walk",
    "sets": "3",
    "reps": "15–20",
    "rest": "45 sec",
    "note": "",
    "ref": "glutes"
   }
  ]
 },
 {
  "id": "glutes-home",
  "name": "Booty at Home",
  "min": 25,
  "focus": "Glutes",
  "where": "home",
  "level": "Beginner",
  "desc": "No equipment needed. Slow reps, squeeze at the top.",
  "items": [
   {
    "name": "Glute Bridge",
    "sets": "3",
    "reps": "15–20",
    "rest": "45 sec",
    "note": "",
    "ref": "glutes/home"
   },
   {
    "name": "Couch Bulgarian Split Squat",
    "sets": "3",
    "reps": "10–12 per leg",
    "rest": "60 sec",
    "note": "",
    "ref": "glutes/home"
   },
   {
    "name": "Single-Leg Glute Bridge",
    "sets": "3",
    "reps": "10–12 per leg",
    "rest": "45 sec",
    "note": "",
    "ref": "glutes/home"
   },
   {
    "name": "Donkey Kick",
    "sets": "3",
    "reps": "15 per leg",
    "rest": "none",
    "note": "Superset A.",
    "ref": "glutes/home",
    "ss": "A"
   },
   {
    "name": "Side Leg Raise",
    "sets": "3",
    "reps": "15 per leg",
    "rest": "45 sec",
    "note": "",
    "ref": "glutes/home",
    "ss": "A"
   }
  ]
 },
 {
  "id": "fullbody-db",
  "name": "Full Body Dumbbell",
  "min": 45,
  "focus": "Full body",
  "where": "home",
  "level": "All levels",
  "desc": "One pair of dumbbells, every muscle, finished with an arm superset.",
  "items": [
   {
    "name": "Goblet or Back Squat",
    "sets": "4",
    "reps": "10–12",
    "rest": "90 sec",
    "note": "Goblet squat with one dumbbell.",
    "ref": "legs"
   },
   {
    "name": "Dumbbell Bench Press",
    "sets": "3",
    "reps": "10–12",
    "rest": "90 sec",
    "note": "On the floor works too.",
    "ref": "chest"
   },
   {
    "name": "Single-Arm Dumbbell Row",
    "sets": "3",
    "reps": "10–12 per arm",
    "rest": "60 sec",
    "note": "",
    "ref": "back"
   },
   {
    "name": "Single-Leg Romanian Deadlift",
    "sets": "3",
    "reps": "8–10 per leg",
    "rest": "60 sec",
    "note": "",
    "ref": "legs"
   },
   {
    "name": "Shoulder Press",
    "sets": "3",
    "reps": "10–12",
    "rest": "60 sec",
    "note": "",
    "ref": "shoulders/home"
   },
   {
    "name": "Biceps Curl",
    "sets": "2",
    "reps": "12–15",
    "rest": "none",
    "note": "Superset A.",
    "ref": "arms/home",
    "ss": "A"
   },
   {
    "name": "Triceps Kickback",
    "sets": "2",
    "reps": "12–15",
    "rest": "60 sec",
    "note": "",
    "ref": "arms/home",
    "ss": "A"
   }
  ]
 },
 {
  "id": "express",
  "name": "Full Body Express",
  "min": 20,
  "focus": "Full body",
  "where": "home",
  "level": "Beginner",
  "desc": "Bodyweight circuit: 5 moves back to back, rest 1 minute, 3 rounds.",
  "items": [
   {
    "name": "Bodyweight Squat",
    "sets": "3",
    "reps": "15",
    "rest": "none",
    "note": "Circuit: go straight to the next move.",
    "ref": "legs/home",
    "ss": "Circuit"
   },
   {
    "name": "Push-Up",
    "sets": "3",
    "reps": "8–15",
    "rest": "none",
    "note": "Knees down is fine.",
    "ref": "chest/home",
    "ss": "Circuit"
   },
   {
    "name": "Reverse Lunge",
    "sets": "3",
    "reps": "10 per leg",
    "rest": "none",
    "note": "",
    "ref": "legs/home",
    "ss": "Circuit"
   },
   {
    "name": "Superman",
    "sets": "3",
    "reps": "12",
    "rest": "none",
    "note": "",
    "ref": "back/home",
    "ss": "Circuit"
   },
   {
    "name": "Mountain Climbers",
    "sets": "3",
    "reps": "30 sec",
    "rest": "60 sec",
    "note": "Then rest a minute and start the next round.",
    "ref": "core/home",
    "ss": "Circuit"
   }
  ]
 },
 {
  "id": "core",
  "name": "Core Crusher",
  "min": 15,
  "focus": "Core",
  "where": "both",
  "level": "All levels",
  "desc": "Quick abs and core you can add to the end of any workout.",
  "items": [
   {
    "name": "Dead Bug",
    "sets": "3",
    "reps": "10 per side",
    "rest": "30 sec",
    "note": "",
    "ref": "core"
   },
   {
    "name": "Reverse Crunch",
    "sets": "3",
    "reps": "12–15",
    "rest": "30 sec",
    "note": "",
    "ref": "core"
   },
   {
    "name": "Plank",
    "sets": "3",
    "reps": "30–45 sec",
    "rest": "30 sec",
    "note": "",
    "ref": "core"
   },
   {
    "name": "Side Plank",
    "sets": "2",
    "reps": "30 sec per side",
    "rest": "30 sec",
    "note": "",
    "ref": "core"
   },
   {
    "name": "Mountain Climbers",
    "sets": "2",
    "reps": "30 sec",
    "rest": "30 sec",
    "note": "",
    "ref": "core/home"
   }
  ]
 },
 {
  "id": "hyrox-engine",
  "name": "HYROX Engine",
  "min": 30,
  "focus": "Conditioning",
  "where": "gym",
  "level": "Intermediate",
  "desc": "4 rounds of run + stations. Log your times and beat them next time.",
  "items": [
   {
    "name": "Run",
    "sets": "4",
    "reps": "500 m",
    "rest": "",
    "note": "Round: run, wall balls, farmers carry, burpee broad jumps. Rest 90 seconds between rounds.",
    "ref": "",
    "log": "time"
   },
   {
    "name": "Wall Balls",
    "sets": "4",
    "reps": "15",
    "rest": "",
    "note": "Men 14 lb, women 9 lb.",
    "ref": "",
    "lb": true
   },
   {
    "name": "Farmers Carry",
    "sets": "4",
    "reps": "50 m",
    "rest": "",
    "note": "Heavy dumbbells or kettlebells.",
    "ref": "",
    "log": "time",
    "lb": true
   },
   {
    "name": "Burpee Broad Jumps",
    "sets": "4",
    "reps": "10 m",
    "rest": "90 sec",
    "note": "Then rest 90 seconds.",
    "ref": "",
    "log": "time"
   }
  ]
 },
 {
  "id": "zone2",
  "name": "Zone 2 Cardio",
  "min": 30,
  "focus": "Conditioning",
  "where": "both",
  "level": "All levels",
  "desc": "Easy steady cardio for heart health and fat loss. Walk, bike, row or jog.",
  "items": [
   {
    "name": "Zone 2 cardio (incline walk, bike, row or easy jog)",
    "sets": "1",
    "reps": "30 min",
    "rest": "",
    "note": "You can talk in full sentences, but not sing. Your Zone 2 heart rate is on your Apple Health card.",
    "ref": ""
   }
  ]
 }
];
