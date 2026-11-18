{
  "schema": "apc-preset/1.0",
  "kind": "patch",
  "id": "pat_00000000-0000-4000-8000-000000000040",
  "name": "Dark Obsidian",
  "author": "Fixture Author",
  "created": "2026-11-01T10:00:00Z",
  "app_version": "1.0.0",
  "meta": {
    "category": "impact",
    "genre": [
      "drum-and-bass"
    ],
    "moods": [
      "dark",
      "aggressive"
    ],
    "desc": "Distorted sub kick with a rolling halftime pattern."
  },
  "kits": [
    {
      "ref": "../sounds/Sub_Distort.snd",
      "id": "snd_00000000-0000-4000-8000-000000000010"
    }
  ],
  "sequences": [
    {
      "ref": "../sequences/Halftime_174.seq",
      "id": "seq_00000000-0000-4000-8000-000000000030",
      "slot": 1
    }
  ],
  "global_fx": {
    "reverb_size": 0.45,
    "reverb_mix": 0.22,
    "master_gain_db": -1
  },
  "macros": [
    {
      "name": "Drive",
      "targets": [
        {
          "dst": "kit.slot[0].drive_amount",
          "amount": 0.8
        }
      ]
    }
  ],
  "modulation": []
}
