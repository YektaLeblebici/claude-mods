import type { Affix, LegendId, PetId, Rarity, Save, Slot, ZoneModifier } from '../types'

export type EnemyDef = {
  name: string
  desc: string
  hp: number
  atk: number
  def: number
  verbs: [string, string]
  /** Its own colour, where the world's foe or boss colour won't do. */
  tint?: string
}

/** A boss; one with `pets` gives one of them at `petChance` when beaten, and they drop nowhere else. */
export type BossDef = EnemyDef & { intro: string; defeat: string; pets?: PetId[]; petChance?: number }

/** A stretch of the year as [month, day] pairs, months from 1; `from` after `to` runs over New Year. */
export type Season = { from: [number, number]; to: [number, number] }

export type Biome = {
  id: string
  /** When set, new zones go here only in this season; otherwise all year. */
  season?: Season
  names: string[]
  descs: string[]
  enemies: EnemyDef[]
  bosses: BossDef[]
  ambient: string[]
}

export const BIOMES: Biome[] = [
  {
    id: 'meadow',
    names: ['Whispering Meadow', 'Sunmote Fields', 'The Clover Downs', 'Thistlewind Vale', 'Hollyhock Green', 'The Lazy Barrows'],
    descs: [
      'Tall grass sways in a breeze that smells of honey and old rain.',
      'Wildflowers carpet the hills; somewhere, a bell tolls for no one.',
      'A deceptively peaceful field. The scarecrows are watching.',
    ],
    enemies: [
      { name: 'Grumpy Badger', desc: 'Small, striped, and furious about everything.', hp: 0.8, atk: 0.9, def: 0.8, verbs: ['bites', 'scratches'] },
      { name: 'Thornback Boar', desc: 'Its bristles are actual brambles.', hp: 1.2, atk: 1.0, def: 1.0, verbs: ['gores', 'tramples'] },
      { name: 'Pixie Prankster', desc: 'Giggles. Steals your bootlaces. Giggles more.', hp: 0.6, atk: 0.8, def: 0.6, verbs: ['zaps', 'pinches'] },
      { name: 'Field Scarecrow', desc: 'Stuffed with straw and a grudge.', hp: 1.0, atk: 0.9, def: 1.1, verbs: ['flails at', 'swipes'] },
      { name: 'Giant Bumblebee', desc: 'The size of a sheep, twice as loud.', hp: 0.7, atk: 1.1, def: 0.7, verbs: ['stings', 'buzzes into'] },
      { name: 'Rogue Gnome', desc: 'Wanted in three villages for garden crimes.', hp: 0.8, atk: 1.0, def: 0.9, verbs: ['stabs', 'kicks'] },
    ],
    bosses: [
      { name: 'The Harvest King', desc: 'A scarecrow crowned in wheat, eyes of candlelight.', hp: 1.0, atk: 1.0, def: 1.0, verbs: ['scythes', 'smothers'], intro: 'The fields fall silent. The Harvest King rises from the furrows.', defeat: 'The Harvest King collapses into a heap of harmless straw.' },
      { name: 'Old Mother Hornet', desc: 'Queen of the meadow hive, armored in amber.', hp: 0.9, atk: 1.1, def: 1.0, verbs: ['stings', 'swarms'], intro: 'A drone like distant thunder. Old Mother Hornet descends.', defeat: 'The great hornet spirals down and the meadow sighs with relief.' },
    ],
    ambient: ['Bees drift lazily between the flowers.', 'You find a perfect skipping stone and keep it.', 'A rabbit watches you with deep suspicion.', 'Clouds shaped like swords drift overhead.', 'The grass parts to reveal an old, mossy signpost.', 'You hum a tune. The scarecrows do not hum back.'],
  },
  {
    id: 'caves',
    names: ['The Gobbler Caves', 'Dripstone Hollows', 'Mudfang Warrens', 'The Echoing Gullet', 'Lanternless Deep', 'Knucklebone Tunnels'],
    descs: [
      'Water drips somewhere in the dark, counting down to something.',
      'The walls are scratched with goblin graffiti, mostly rude.',
      'A cold draft carries the smell of wet stone and cheap stew.',
    ],
    enemies: [
      { name: 'Goblin Sneak', desc: 'All elbows, teeth, and borrowed knives.', hp: 0.8, atk: 1.0, def: 0.8, verbs: ['shanks', 'jabs'] },
      { name: 'Cave Bat Swarm', desc: 'A screeching cloud of tiny wings.', hp: 0.6, atk: 0.9, def: 0.5, verbs: ['nips', 'engulfs'] },
      { name: 'Goblin Brute', desc: 'The goblin who ate the other goblins’ lunch.', hp: 1.3, atk: 1.1, def: 1.0, verbs: ['clubs', 'body-slams'] },
      { name: 'Glowworm Lurker', desc: 'Beautiful lights. Very many teeth.', hp: 0.9, atk: 1.0, def: 0.8, verbs: ['lunges at', 'snaps at'] },
      { name: 'Rock Mimic', desc: 'Looks exactly like a rock. Is not a rock.', hp: 1.1, atk: 0.9, def: 1.5, verbs: ['crushes', 'headbutts'] },
      { name: 'Goblin Shaman', desc: 'Shakes a stick of bones with great conviction.', hp: 0.7, atk: 1.2, def: 0.7, verbs: ['hexes', 'curses'] },
    ],
    bosses: [
      { name: 'Grizzlegut, Goblin Warlord', desc: 'Wears a cauldron as a helmet. It works.', hp: 1.1, atk: 1.0, def: 1.1, verbs: ['cleaves', 'belly-flops onto'], intro: 'War drums echo. Grizzlegut kicks over his throne and charges.', defeat: 'Grizzlegut topples, and the goblins scatter into the dark.' },
      { name: 'The Deep Maw', desc: 'A cave that is also a mouth.', hp: 1.2, atk: 0.9, def: 1.0, verbs: ['swallows', 'grinds'], intro: 'The tunnel ahead yawns wider. It is breathing.', defeat: 'The Maw shudders and seals shut forever.' },
    ],
    ambient: ['Your torch gutters, then steadies.', 'You step over a goblin’s lost sock.', 'Crystals glitter faintly in the walls.', 'Somewhere far below, something laughs.', 'A rusty sign reads: TURN BAK.', 'You find a stew pot, still warm. You do not taste it.'],
  },
  {
    id: 'woods',
    names: ['The Haunted Woods', 'Gloamwood', 'Weeping Pines', 'The Hollow Grove', 'Ravensroost Thicket', 'Mournbark Forest'],
    descs: [
      'Branches knit overhead; daylight comes in thin, frightened slices.',
      'Every tree here has a face if you look long enough. Don’t.',
      'Fog curls around roots like it is looking for someone.',
    ],
    enemies: [
      { name: 'Wailing Wisp', desc: 'A lantern-light that sobs and lures.', hp: 0.6, atk: 1.2, def: 0.6, verbs: ['sears', 'chills'] },
      { name: 'Dire Wolf', desc: 'Grey as fog and twice as quiet.', hp: 1.0, atk: 1.1, def: 0.9, verbs: ['mauls', 'bites'] },
      { name: 'Twigling', desc: 'A knot of sticks that learned to hate.', hp: 0.8, atk: 0.9, def: 1.1, verbs: ['whips', 'pokes'] },
      { name: 'Grave Crow', desc: 'Knows your name. Says it wrong on purpose.', hp: 0.6, atk: 1.0, def: 0.6, verbs: ['pecks', 'shrieks at'] },
      { name: 'Hollow Stag', desc: 'Antlers of bone, eyes of empty sky.', hp: 1.2, atk: 1.1, def: 1.0, verbs: ['gores', 'charges'] },
      { name: 'Restless Woodcutter', desc: 'Still chopping, long after death.', hp: 1.1, atk: 1.2, def: 0.9, verbs: ['chops', 'hacks at'] },
    ],
    bosses: [
      { name: 'The Elder Bark', desc: 'The oldest tree, and the angriest.', hp: 1.3, atk: 0.9, def: 1.2, verbs: ['crushes', 'entangles'], intro: 'The ground heaves. The Elder Bark tears its roots free.', defeat: 'The Elder Bark groans and finally, gratefully, sleeps.' },
      { name: 'The Lady in Grey', desc: 'A widow of mist with a voice like wind in a flue.', hp: 0.9, atk: 1.2, def: 0.9, verbs: ['wails at', 'drains'], intro: 'The fog gathers into a woman. She is not smiling.', defeat: 'The Lady in Grey thins to nothing, and birdsong returns.' },
    ],
    ambient: ['An owl turns its head and keeps turning.', 'You find initials carved in a trunk: yours.', 'Footsteps follow, then stop when you do.', 'Mushrooms glow a sickly green.', 'A swing creaks on a branch with no wind.', 'The path behind you is gone.'],
  },
  {
    id: 'swamp',
    names: ['Rotmire Bog', 'The Sunken Fen', 'Gurglewater Marsh', 'Leechlight Mire', 'The Drowned Parish', 'Mosscrawl Wetlands'],
    descs: [
      'Every step squelches. Some of the squelches squelch back.',
      'Bubbles rise from the black water and burst into words.',
      'Half-sunk houses lean in the reeds like tired drunks.',
    ],
    enemies: [
      { name: 'Bog Leech', desc: 'Long as your arm, hungry as a tax collector.', hp: 0.9, atk: 0.9, def: 0.7, verbs: ['latches onto', 'drains'] },
      { name: 'Mire Frog', desc: 'Its croak rattles your teeth.', hp: 0.8, atk: 1.0, def: 0.8, verbs: ['tongue-lashes', 'slams'] },
      { name: 'Swamp Hag', desc: 'Sells cursed teas at very reasonable prices.', hp: 0.8, atk: 1.3, def: 0.7, verbs: ['hexes', 'claws'] },
      { name: 'Bog Body', desc: 'Preserved perfectly, temperament included.', hp: 1.2, atk: 1.0, def: 1.1, verbs: ['strangles', 'pummels'] },
      { name: 'Will-o’-Lantern', desc: 'A floating light with a thief’s grin.', hp: 0.6, atk: 1.1, def: 0.6, verbs: ['burns', 'blinds'] },
      { name: 'Snapjaw Turtle', desc: 'Older than the village. Grumpier too.', hp: 1.1, atk: 0.9, def: 1.6, verbs: ['snaps at', 'bites'] },
    ],
    bosses: [
      { name: 'Mother Mudwallow', desc: 'A hag the size of a barn, wading with a ladle.', hp: 1.2, atk: 1.0, def: 1.0, verbs: ['ladles', 'curses'], intro: 'The bog boils. Mother Mudwallow wants a new ingredient.', defeat: 'Mother Mudwallow sinks, still muttering recipes.' },
      { name: 'The Gulper', desc: 'An eel with a lamp on its head and appetite in its heart.', hp: 1.1, atk: 1.1, def: 0.9, verbs: ['gulps', 'coils around'], intro: 'A light bobs in the water, then rises on a long, long body.', defeat: 'The Gulper slips beneath the surface, belly-up.' },
    ],
    ambient: ['A heron spears a fish and stares at you.', 'Your boot stays behind. You retrieve it.', 'Mist hangs at exactly knee height.', 'Something drags a bell under the water.', 'Fireflies spell something, then scatter.', 'The reeds whisper gossip about you.'],
  },
  {
    id: 'desert',
    names: ['The Glass Dunes', 'Sunscour Wastes', 'Ruins of Qa’haar', 'The Bleached Expanse', 'Scorpion’s Cradle', 'Mirage Road'],
    descs: [
      'Heat shimmers over sand fused into glittering glass.',
      'Pillars of a forgotten empire poke from the dunes like ribs.',
      'The wind carries sand, and sometimes voices.',
    ],
    enemies: [
      { name: 'Dune Scorpion', desc: 'A tail like a spear, a temper like a kettle.', hp: 1.0, atk: 1.2, def: 1.1, verbs: ['stings', 'pinches'] },
      { name: 'Sand Wraith', desc: 'A whirlwind with a face in it.', hp: 0.8, atk: 1.1, def: 0.7, verbs: ['scours', 'buffets'] },
      { name: 'Tomb Guardian', desc: 'Wrapped in linen and old oaths.', hp: 1.3, atk: 1.0, def: 1.2, verbs: ['smites', 'grapples'] },
      { name: 'Vulture Knight', desc: 'Feathered helm, rusted lance, patient eyes.', hp: 1.0, atk: 1.1, def: 1.0, verbs: ['lances', 'rakes'] },
      { name: 'Mirage Jackal', desc: 'There are three of it. Or none.', hp: 0.7, atk: 1.1, def: 0.7, verbs: ['bites', 'flanks'] },
      { name: 'Glass Golem', desc: 'Sunlight refracts through it, painfully.', hp: 1.2, atk: 0.9, def: 1.4, verbs: ['shatters into', 'dazzles'] },
    ],
    bosses: [
      { name: 'Pharaoh Ankh-Ra-Bad', desc: 'A mummy king who never accepted retirement.', hp: 1.2, atk: 1.0, def: 1.2, verbs: ['curses', 'commands sand against'], intro: 'A sarcophagus grinds open. The Pharaoh demands tribute.', defeat: 'The Pharaoh crumbles to dust and a single gold coin.' },
      { name: 'The Sandworm Ouroth', desc: 'Its passing reshapes the desert.', hp: 1.4, atk: 1.1, def: 0.9, verbs: ['engulfs', 'thrashes'], intro: 'The dunes ripple. Ouroth surfaces, mouth first.', defeat: 'Ouroth burrows away, wounded, never to return.' },
    ],
    ambient: ['You see an oasis. It is not there.', 'A half-buried statue points west, accusingly.', 'Sand gets into places you did not know you had.', 'A caravan’s bones lie in perfect formation.', 'Stars come out, impossibly bright.', 'You find an empty waterskin. Ominous.'],
  },
  {
    id: 'frost',
    names: ['Frostfang Peaks', 'The Shivering Pass', 'Rimeheart Glacier', 'Howling Summit', 'Icewake Ridge', 'The Pale Crown'],
    descs: [
      'Wind screams across the ridge, carrying needles of ice.',
      'Blue glaciers groan, older than any kingdom.',
      'Your breath freezes into tiny, shocked faces.',
    ],
    enemies: [
      { name: 'Frost Wolf', desc: 'Its howl drops the temperature further.', hp: 1.0, atk: 1.1, def: 0.9, verbs: ['bites', 'pounces on'] },
      { name: 'Ice Imp', desc: 'Throws snowballs with rocks in them.', hp: 0.7, atk: 1.1, def: 0.7, verbs: ['pelts', 'freezes'] },
      { name: 'Yeti', desc: 'Shy, enormous, and very, very strong.', hp: 1.4, atk: 1.2, def: 1.0, verbs: ['pummels', 'hurls'] },
      { name: 'Frozen Soldier', desc: 'Still guarding a pass nobody uses.', hp: 1.1, atk: 1.0, def: 1.3, verbs: ['spears', 'shield-bashes'] },
      { name: 'Snow Harpy', desc: 'Shrieks hail from above.', hp: 0.8, atk: 1.2, def: 0.7, verbs: ['rakes', 'dives at'] },
      { name: 'Living Avalanche', desc: 'Rumbles. Tumbles. Comes back for more.', hp: 1.3, atk: 1.0, def: 1.2, verbs: ['buries', 'crashes into'] },
    ],
    bosses: [
      { name: 'Jarl Hrimgrim', desc: 'A frost giant who collects heroes as ice sculptures.', hp: 1.3, atk: 1.1, def: 1.1, verbs: ['hammers', 'stomps'], intro: 'The mountain shakes. Jarl Hrimgrim wants a new sculpture.', defeat: 'Hrimgrim falls, and the avalanche he caused buries him gently.' },
      { name: 'The White Wyrm', desc: 'A dragon of snow, coiled around the summit.', hp: 1.2, atk: 1.2, def: 1.0, verbs: ['breathes frost on', 'bites'], intro: 'The snowfield opens one enormous eye.', defeat: 'The White Wyrm shatters into a gentle, glittering snowfall.' },
    ],
    ambient: ['An avalanche rumbles somewhere else, thankfully.', 'You find a frozen adventurer. He waves? No.', 'Icicles chime like glass bells.', 'Aurora ripples green across the sky.', 'Your eyebrows have frozen solid.', 'A mountain goat judges your technique.'],
  },
  {
    id: 'volcano',
    names: ['The Ashen Hollow', 'Cinderfall Reach', 'Mount Brimstone', 'The Smouldering Vents', 'Obsidian Steps', 'Emberheart Caldera'],
    descs: [
      'Rivers of lava light the cavern in angry orange.',
      'Ash falls like grey snow; the ground is warm through your boots.',
      'Obsidian glints in black, mirror-sharp ridges.',
    ],
    enemies: [
      { name: 'Cinder Imp', desc: 'A gremlin made of embers and spite.', hp: 0.7, atk: 1.2, def: 0.7, verbs: ['scorches', 'flicks fire at'] },
      { name: 'Magma Slug', desc: 'Slow. Unstoppable. Leaves a molten trail.', hp: 1.3, atk: 0.9, def: 1.3, verbs: ['oozes over', 'burns'] },
      { name: 'Salamander', desc: 'A lizard that swims in fire for fun.', hp: 0.9, atk: 1.1, def: 0.9, verbs: ['bites', 'tail-whips'] },
      { name: 'Ash Wraith', desc: 'The ghost of something that burned.', hp: 0.8, atk: 1.2, def: 0.7, verbs: ['smothers', 'chokes'] },
      { name: 'Obsidian Golem', desc: 'Volcanic glass, sharpened by hatred.', hp: 1.3, atk: 1.0, def: 1.5, verbs: ['slices', 'slams'] },
      { name: 'Fire Cultist', desc: 'Chants about the Great Burning. Loudly.', hp: 0.9, atk: 1.2, def: 0.8, verbs: ['firebolts', 'stabs'] },
    ],
    bosses: [
      { name: 'Vulkazar the Molten', desc: 'A titan of magma, crowned in smoke.', hp: 1.3, atk: 1.2, def: 1.1, verbs: ['erupts on', 'pounds'], intro: 'The caldera boils over. Vulkazar rises, dripping fire.', defeat: 'Vulkazar cools into a great black statue.' },
      { name: 'The Phoenix Tyrant', desc: 'Reborn a thousand times, unpleasant every time.', hp: 1.0, atk: 1.3, def: 1.0, verbs: ['immolates', 'rakes'], intro: 'A sun ignites overhead. It has wings.', defeat: 'The Phoenix dwindles to an ember. It will be back, later.' },
    ],
    ambient: ['A lava bubble pops, startlingly close.', 'You toast bread on a vent. Excellent.', 'The heat warps your reflection into a stranger.', 'Sulfur stings your eyes.', 'You find a melted helmet. Keep moving.', 'The mountain grumbles like an old dog.'],
  },
  {
    id: 'crypt',
    names: ['The Bonewright Crypt', 'Ossuary of Saint Vell', 'Catacombs Below', 'The Quiet Vaults', 'Gravewind Halls', 'The Lich’s Library'],
    descs: [
      'Skulls line the walls in neat, unsettling rows.',
      'Candles burn here that nobody lit.',
      'The air is dry and tastes of dust and old prayers.',
    ],
    enemies: [
      { name: 'Skeleton Warrior', desc: 'Rattles when it walks. Rattles when it kills.', hp: 0.9, atk: 1.0, def: 1.0, verbs: ['slashes', 'bonks'] },
      { name: 'Ghoul', desc: 'Long nails, longer appetite.', hp: 1.0, atk: 1.1, def: 0.8, verbs: ['claws', 'gnaws on'] },
      { name: 'Banshee', desc: 'Her scream can crack bone.', hp: 0.7, atk: 1.3, def: 0.6, verbs: ['screams at', 'chills'] },
      { name: 'Crypt Spider', desc: 'Eight legs, eight eyes, zero mercy.', hp: 0.9, atk: 1.1, def: 0.9, verbs: ['bites', 'webs'] },
      { name: 'Animated Armor', desc: 'Empty inside, but very motivated.', hp: 1.2, atk: 1.0, def: 1.5, verbs: ['strikes', 'bashes'] },
      { name: 'Necromancer Acolyte', desc: 'Still learning. Already dangerous.', hp: 0.8, atk: 1.3, def: 0.7, verbs: ['drains', 'curses'] },
    ],
    bosses: [
      { name: 'Lich-Archivist Morrow', desc: 'A dead scholar who will file you under “Deceased”.', hp: 1.1, atk: 1.3, def: 1.0, verbs: ['withers', 'unwrites'], intro: 'Pages flutter. Morrow closes a book bound in skin and looks up.', defeat: 'Morrow’s phylactery cracks, and his library falls silent.' },
      { name: 'The Bone Colossus', desc: 'A thousand skeletons who agreed to be one.', hp: 1.5, atk: 1.0, def: 1.1, verbs: ['crushes', 'sweeps'], intro: 'The bones in the walls begin to move, together.', defeat: 'The Colossus clatters apart into a thousand quiet bones.' },
    ],
    ambient: ['A skull’s jaw drops open as you pass.', 'You find a book titled “How To Leave”.', 'The candles lean away from you.', 'A tomb lid is slightly ajar. You leave it.', 'Bones crunch underfoot. Sorry.', 'An epitaph reads: “Should have brought potions.”'],
  },
  {
    id: 'sky',
    names: ['The Cloudspire Isles', 'Stormreach Archipelago', 'Windmere Heights', 'The Floating Gardens', 'Thunderhead Citadel', 'Skyhook Docks'],
    descs: [
      'Islands drift in a sea of cloud, tethered by ancient chains.',
      'Lightning crawls along the edges of the sky like cracks in glass.',
      'Below, far below, the world is a patchwork quilt.',
    ],
    enemies: [
      { name: 'Storm Hawk', desc: 'Feathers crackle with static.', hp: 0.8, atk: 1.2, def: 0.8, verbs: ['strikes', 'dives at'] },
      { name: 'Cloud Giantling', desc: 'A teenager by giant standards. Moody.', hp: 1.4, atk: 1.1, def: 1.0, verbs: ['stomps', 'shoves'] },
      { name: 'Air Elemental', desc: 'A living gale with a bad attitude.', hp: 0.9, atk: 1.1, def: 0.8, verbs: ['buffets', 'whirls'] },
      { name: 'Sky Pirate', desc: 'Grappling hook, eyepatch, big hat.', hp: 1.0, atk: 1.1, def: 0.9, verbs: ['cutlasses', 'kicks'] },
      { name: 'Thunder Ram', desc: 'Every headbutt is a thunderclap.', hp: 1.1, atk: 1.2, def: 1.1, verbs: ['rams', 'shocks'] },
      { name: 'Clockwork Sentinel', desc: 'Built by someone who loved gears too much.', hp: 1.2, atk: 1.0, def: 1.4, verbs: ['zaps', 'drills'] },
    ],
    bosses: [
      { name: 'Captain Galeheart', desc: 'Sky pirate queen, master of the airship Gust.', hp: 1.1, atk: 1.2, def: 1.0, verbs: ['broadsides', 'duels'], intro: 'Cannons boom. Captain Galeheart swings down on a rope.', defeat: 'Galeheart salutes, leaps overboard, and opens a parachute.' },
      { name: 'The Storm Roc', desc: 'A bird so vast it has its own weather.', hp: 1.3, atk: 1.2, def: 1.0, verbs: ['lightning-strikes', 'snatches'], intro: 'The sky goes dark. It is not a cloud. It has wings.', defeat: 'The Storm Roc soars away, and the sun returns.' },
    ],
    ambient: ['A chain groans as your island drifts.', 'You catch a falling star. It is a pebble.', 'Wind tries to steal your hat. Succeeds.', 'A rainbow arcs beneath your feet.', 'Lightning writes your initials. Rude.', 'Geese fly by in perfect V. Below you.'],
  },
  {
    id: 'sunken',
    names: ['The Sunken City of Merrow', 'Coral Cathedral', 'The Abyssal Trench', 'Kelpshroud Ruins', 'Tidewrack Halls', 'The Pearl Labyrinth'],
    descs: [
      'Bubble-charms let you breathe. Mostly.',
      'Coral has grown through the windows of drowned palaces.',
      'Bioluminescent fish light the dark like wandering stars.',
    ],
    enemies: [
      { name: 'Merrow Raider', desc: 'Trident, scales, terrible manners.', hp: 1.0, atk: 1.1, def: 1.0, verbs: ['tridents', 'drags'] },
      { name: 'Reef Shark', desc: 'Smells fear. Smells you.', hp: 1.1, atk: 1.2, def: 0.9, verbs: ['bites', 'rams'] },
      { name: 'Jelly Specter', desc: 'Translucent, trailing stinging threads.', hp: 0.7, atk: 1.2, def: 0.6, verbs: ['stings', 'entangles'] },
      { name: 'Hermit Knight', desc: 'A crab in a stolen helmet.', hp: 1.1, atk: 1.0, def: 1.5, verbs: ['pinches', 'shell-bashes'] },
      { name: 'Siren', desc: 'Sings a song about you. It ends badly.', hp: 0.8, atk: 1.3, def: 0.7, verbs: ['enthralls', 'claws'] },
      { name: 'Anglerfiend', desc: 'Follow the light. Do not follow the light.', hp: 1.0, atk: 1.1, def: 0.9, verbs: ['chomps', 'lures'] },
    ],
    bosses: [
      { name: 'The Drowned King', desc: 'A monarch who refused to leave his flooded throne.', hp: 1.2, atk: 1.1, def: 1.2, verbs: ['tides against', 'impales'], intro: 'The throne room floods with cold light. The King stands.', defeat: 'The Drowned King sinks into his throne and finally rests.' },
      { name: 'Kraken Matriarch', desc: 'Eight arms, eight grudges.', hp: 1.5, atk: 1.1, def: 0.9, verbs: ['crushes', 'inks'], intro: 'Tentacles rise from the trench like pillars.', defeat: 'The Kraken retreats into the deep, leaving only ink.' },
    ],
    ambient: ['A school of fish parts around you.', 'You find a message in a bottle: “HELP (also hi)”.', 'A statue’s eyes follow you, coral-crusted.', 'Bubbles rise from a mosaic floor.', 'Distant whale-song shakes the water.', 'An octopus steals your spoon.'],
  },
  {
    id: 'clockwork',
    names: ['The Cogwork Foundry', 'Brassheart Spire', 'The Ticking Undercity', 'Gearmind Labyrinth', 'Steamvent Arsenal', 'The Unwinding Halls'],
    descs: [
      'Gears the size of houses turn in perfect, deafening rhythm.',
      'Steam hisses from pipes that go everywhere and nowhere.',
      'Every surface ticks. Something is counting down.',
    ],
    enemies: [
      { name: 'Clockwork Hound', desc: 'Wind-up, loyal, and full of springs.', hp: 0.9, atk: 1.1, def: 1.1, verbs: ['bites', 'pounces on'] },
      { name: 'Steam Knight', desc: 'Pistons for muscles, boiler for a heart.', hp: 1.3, atk: 1.1, def: 1.3, verbs: ['punches', 'scalds'] },
      { name: 'Spark Sprite', desc: 'Lives in the wiring. Loves short circuits.', hp: 0.6, atk: 1.3, def: 0.6, verbs: ['shocks', 'zaps'] },
      { name: 'Gearspider', desc: 'Eight legs, all of them drills.', hp: 0.9, atk: 1.1, def: 1.0, verbs: ['drills', 'skitters over'] },
      { name: 'Rogue Automaton', desc: 'Its instructions have become… creative.', hp: 1.1, atk: 1.0, def: 1.2, verbs: ['malfunctions at', 'strikes'] },
      { name: 'Brass Bombardier', desc: 'Carries far too many explosives.', hp: 0.9, atk: 1.4, def: 0.8, verbs: ['bombs', 'blasts'] },
    ],
    bosses: [
      { name: 'The Grand Mechanist', desc: 'Half inventor, half invention, wholly mad.', hp: 1.2, atk: 1.2, def: 1.2, verbs: ['lasers', 'wrenches'], intro: 'Gears halt. The Grand Mechanist adjusts her goggles.', defeat: 'The Mechanist’s suit sparks, sputters, and powers down.' },
      { name: 'Unit Zero', desc: 'The first machine. It remembers everything.', hp: 1.4, atk: 1.1, def: 1.3, verbs: ['calculates against', 'crushes'], intro: 'A single red eye opens: “HELLO. GOODBYE.”', defeat: 'Unit Zero’s eye dims: “…NEW DATA ACQUIRED.”' },
    ],
    ambient: ['A pipe bursts, then patches itself.', 'You find a gear stamped “DO NOT REMOVE”. You don’t.', 'A clock strikes thirteen.', 'Conveyor belts carry tiny brass birds.', 'Oil drips on your shoulder. Lovely.', 'A sign reads “Days without incident: 0”.'],
  },
  {
    id: 'void',
    names: ['The Hollow Between', 'Starless Expanse', 'The Unmade Reaches', 'Edge of Everything', 'The Whispering Null', 'Fractured Eternity'],
    descs: [
      'Stars hang close enough to touch, and hum faintly.',
      'Gravity is more of a suggestion here.',
      'Reality frays at the edges like an old tapestry.',
    ],
    enemies: [
      { name: 'Void Stalker', desc: 'A shape that is mostly absence.', hp: 1.0, atk: 1.3, def: 0.8, verbs: ['unravels', 'rends'] },
      { name: 'Star Eater', desc: 'Its mouth contains a small galaxy.', hp: 1.3, atk: 1.1, def: 1.0, verbs: ['devours', 'gnaws'] },
      { name: 'Paradox Imp', desc: 'Defeated you yesterday. Tomorrow.', hp: 0.7, atk: 1.2, def: 0.7, verbs: ['rewinds', 'confuses'] },
      { name: 'Gaze of the Deep', desc: 'An eye, floating, curious, hostile.', hp: 0.9, atk: 1.3, def: 0.8, verbs: ['glares at', 'disintegrates'] },
      { name: 'Null Knight', desc: 'Armor made of nothing, filled with nothing.', hp: 1.2, atk: 1.1, def: 1.4, verbs: ['erases', 'strikes'] },
      { name: 'Echo of You', desc: 'Your worst habits, made flesh.', hp: 1.0, atk: 1.2, def: 1.0, verbs: ['mimics', 'mocks'] },
    ],
    bosses: [
      { name: 'The Nameless One', desc: 'It had a name. It ate it.', hp: 1.4, atk: 1.3, def: 1.1, verbs: ['unmakes', 'consumes'], intro: 'The stars go out, one by one. Something has noticed you.', defeat: 'The Nameless One folds into a point and blinks out.' },
      { name: 'Entropy Herself', desc: 'The end of all things, wearing a polite smile.', hp: 1.3, atk: 1.4, def: 1.0, verbs: ['decays', 'ends'], intro: '“Oh,” she says, kindly. “You’re still here?”', defeat: 'Entropy smiles: “Later, then.” She is gone.' },
    ],
    ambient: ['You hear your own footsteps, a second late.', 'A comet passes, waving.', 'You find a door standing in nothing. Locked.', 'The silence is very loud here.', 'Your shadow wanders off for a bit.', 'A star whispers your next commit message.'],
  },
  {
    id: 'christmas',
    season: { from: [11, 15], to: [1, 15] },
    names: ['The Christmas Market', 'Mistletoe Hollow', 'The Gingerbread Quarter'],
    descs: [
      'Stalls glow with candles and the air smells of cinnamon and hot wine.',
      'Snow falls in fat, slow flakes. Somewhere, sleigh bells.',
      'Every roof is iced, every window lit, and something is watching from the chimneys.',
    ],
    enemies: [
      { name: 'Gingerbread Brute', desc: 'Baked too long. Holds a grudge about it.', hp: 1.2, atk: 1.1, def: 1.0, verbs: ['crumbles onto', 'icing-slaps'], tint: '#c07a3a' },
      { name: 'Snowman Sentry', desc: 'Carrot nose, coal eyes, zero mercy.', hp: 1.1, atk: 0.9, def: 1.3, verbs: ['pelts', 'body-checks'], tint: '#f5f5f5' },
      { name: 'Rogue Elf', desc: 'Quit the workshop. Kept the tools.', hp: 0.7, atk: 1.2, def: 0.7, verbs: ['hammers', 'jabs'], tint: '#43a047' },
    ],
    bosses: [
      { name: 'Krampus', desc: "Santa's shadow, with chains and a sack for the naughty.", hp: 1.2, atk: 1.2, def: 1.0, verbs: ['lashes', 'rattles chains at'], tint: '#8d6e63', intro: 'Chains rattle down the lane and every candle gutters. Krampus has checked his list.', defeat: 'Krampus drops his chains and slinks back up the chimney he came from.' },
      { name: 'Santa Claus', desc: 'Here to test whether you are naughty or nice. Hits like a sack of presents.', hp: 1.3, atk: 1.0, def: 1.1, verbs: ['sleigh-bashes', 'pelts with coal'], tint: '#e53935', intro: 'Sleigh bells, then a thud. Santa Claus cracks his knuckles: "Let\'s see if you\'re nice."', defeat: 'Santa Claus laughs, "Ho ho ho! Nice, after all," and dusts the snow off his coat.', pets: ['reindeer', 'snowman'], petChance: 0.1 },
    ],
    ambient: ['A choir sings three streets away, slightly off-key.', 'You buy a roasted chestnut. It is mostly shell.', 'Someone has hung mistletoe over the path. Clawd walks faster.', 'A gingerbread house is missing a wall. Crumbs lead away.', 'Snow settles on your shoulders like a cloak.', 'A child points at you and shouts "Elf!"'],
  },
]

export const MODIFIERS: Record<ZoneModifier, { label: string; desc: string }> = {
  misty: { label: 'Misty', desc: 'Fewer encounters in the fog.' },
  cursed: { label: 'Cursed', desc: 'Unlucky ticks hit 50% harder.' },
  bountiful: { label: 'Bountiful', desc: 'Gold flows freely here.' },
  haunted: { label: 'Haunted', desc: 'Elites stalk these lands.' },
  blessed: { label: 'Blessed', desc: 'Lucky ticks are 50% stronger.' },
}

export const ITEM_BASES: Record<Slot, string[]> = {
  weapon: ['Rusty Dagger', 'Short Sword', 'Hand Axe', 'Mace', 'Longsword', 'War Hammer', 'Glaive', 'Runeblade', 'Starforged Edge'],
  armor: ['Padded Vest', 'Leather Jerkin', 'Studded Leather', 'Chainmail', 'Scale Hauberk', 'Plate Cuirass', 'Mithril Coat', 'Dragonscale Mail', 'Aetherweave'],
  trinket: ['Lucky Pebble', 'Copper Ring', 'Rabbit’s Foot', 'Silver Charm', 'Clover Amulet', 'Jade Talisman', 'Moonstone Ring', 'Phoenix Feather', 'Star Shard'],
}

export const LEGENDARIES: Record<Slot, string[]> = {
  weapon: ['Segfault, Bane of Pointers', 'The Hotfix', 'Ctrl+Z, the Undoer', 'Mjölnir.js', 'Excalibash'],
  armor: ['Aegis of Green Builds', 'The Try-Catch Cuirass', 'Mantle of the Senior Engineer', 'Firewall Plate'],
  trinket: ['The Rubber Duck of Insight', 'Amulet of 100% Coverage', 'Ring of the Merge Train', 'The Lucky Commit'],
}

export const RARITY_MULT: Record<Rarity, number> = { common: 1, uncommon: 1.2, rare: 1.5, epic: 1.9, legendary: 2.5 }
export const RARITY_AFFIXES: Record<Rarity, number> = { common: 0, uncommon: 1, rare: 1, epic: 2, legendary: 3 }
export const RARITY_WEIGHTS: [Rarity, number][] = [['common', 52], ['uncommon', 28], ['rare', 14], ['epic', 5], ['legendary', 1]]

export const AFFIX_INFO: Record<Affix, { prefix?: string; suffix?: string; desc: string }> = {
  keen: { prefix: 'Keen', desc: '+5% crit' },
  sturdy: { prefix: 'Sturdy', desc: '+DEF' },
  fortunate: { prefix: 'Fortunate', desc: 'Lucky effects ×1.5' },
  swift: { prefix: 'Swift', desc: '+1 explore on neutral ticks' },
  warding: { prefix: 'Warding', desc: 'Unlucky miss chance halved' },
  vampiric: { suffix: 'of Vampirism', desc: '10% lifesteal' },
  thorns: { suffix: 'of Thorns', desc: 'Reflect 15% damage' },
}

export const SKILLS: { level: number; name: string; desc: string }[] = [
  { level: 3, name: 'Power Strike', desc: 'Every 4th exchange deals ×2 damage' },
  { level: 5, name: 'Second Wind', desc: 'Once per fight, heal 30% below 25% HP' },
  { level: 8, name: 'Fortune’s Favor', desc: 'Lucky ticks grant +25% XP' },
  { level: 12, name: 'Riposte', desc: '20% chance to counter when hit' },
  { level: 16, name: 'Execute', desc: 'Finish non-bosses below 15% HP' },
  { level: 20, name: 'Iron Will', desc: 'Unlucky penalties halved' },
]

/**
 * Combat wording by how hard a hit lands (see hitTier): plain at first, then stronger verbs, then
 * colour, bold, CAPS and a frame for the very hardest. Clawd's verbs are [you-form, it-form].
 */
export const HERO_VERBS: [string, string][][] = [
  [['hit', 'hits'], ['strike', 'strikes'], ['jab', 'jabs'], ['nick', 'nicks']],
  [['slash', 'slashes'], ['smack', 'smacks'], ['wallop', 'wallops'], ['clobber', 'clobbers'], ['pummel', 'pummels']],
  [['maul', 'mauls'], ['pound', 'pounds'], ['hammer', 'hammers'], ['crush', 'crushes'], ['batter', 'batters']],
  [['DEVASTATE', 'DEVASTATES'], ['DEMOLISH', 'DEMOLISHES'], ['PULVERIZE', 'PULVERIZES'], ['WRECK', 'WRECKS']],
  [['ANNIHILATE', 'ANNIHILATES'], ['OBLITERATE', 'OBLITERATES'], ['ERADICATE', 'ERADICATES']],
]
/** Enemies use their own two verbs for light hits; from tier 2 these. */
export const FOE_VERBS: string[][] = [
  [],
  [],
  ['batters', 'rends', 'slams', 'mauls', 'thrashes'],
  ['SAVAGES', 'MANGLES', 'BRUTALIZES', 'WALLOPS'],
  ['DEVASTATES', 'OBLITERATES', 'DECIMATES'],
]
/** Shades for tiers 2–4: reds when Clawd lands it, oranges when Clawd takes it. */
export const HERO_TONES = ['', '', '#ff8a80', '#ff5252', '#ff1744']
export const FOE_TONES = ['', '', '#ffcc80', '#ffa726', '#ff6d00']

export type PetBonus = 'potion' | 'xp' | 'crit' | 'atk' | 'def' | 'gold' | 'find' | 'hp'

/**
 * Companions: one follows Clawd at a time. Each bonus is deliberately tiny, and grows by half its
 * base per level past the first (a duplicate find is a level, up to PET_MAX_LEVEL).
 */
export const PETS: Record<PetId, { name: string; bonus: PetBonus; base: number; unit: string; color: string }> = {
  slime: { name: 'Slime', bonus: 'potion', base: 5, unit: '% potion healing', color: '#7cd36b' },
  duck: { name: 'Rubber Duck', bonus: 'xp', base: 3, unit: '% XP', color: '#ffd23f' },
  bat: { name: 'Bat', bonus: 'crit', base: 2, unit: '% crit', color: '#9c8ade' },
  dragon: { name: 'Tiny Dragon', bonus: 'atk', base: 1, unit: ' ATK', color: '#ff6f4f' },
  turtle: { name: 'Pebble Turtle', bonus: 'def', base: 1, unit: ' DEF', color: '#5fb38a' },
  cat: { name: 'Lucky Cat', bonus: 'gold', base: 3, unit: '% gold', color: '#f0a8c8' },
  owl: { name: 'Owl', bonus: 'find', base: 1, unit: '% item find', color: '#c69c6d' },
  wisp: { name: 'Wisp', bonus: 'hp', base: 2, unit: '% max HP', color: '#8fe3ff' },
  // Wild characters: never dropped at random, only won by beating them (see LEGENDS).
  tim: { name: 'Tim Apple', bonus: 'gold', base: 3, unit: '% gold', color: '#78909c' },
  tarbolts: { name: 'Linux Tarbolts', bonus: 'crit', base: 2, unit: '% crit', color: '#8d6e63' },
  freeman: { name: 'Gordon Freeman', bonus: 'def', base: 1, unit: ' DEF', color: '#ff8f00' },
  sam: { name: 'Sam Altermann', bonus: 'xp', base: 3, unit: '% XP', color: '#7fa7c9' },
  // Christmas pets: only Santa gives them (see the christmas world's bosses).
  reindeer: { name: 'Little Reindeer', bonus: 'crit', base: 2, unit: '% crit', color: '#a1887f' },
  snowman: { name: 'Jolly Snowman', bonus: 'def', base: 1, unit: ' DEF', color: '#f5f5f5' },
}
export const PET_MAX_LEVEL = 5

/**
 * Wild characters: very rare, level-gated, tougher than elites. Each is introduced with "A wild …
 * appears!" and, once beaten, joins as a pet (its PETS entry) and never appears again.
 */
export type Legend = EnemyDef & { id: LegendId; minLevel: number; defeat: string }

export const LEGENDS: Legend[] = [
  { id: 'tim', minLevel: 5, name: 'Tim Apple', desc: 'Calm, polished, and charging extra for the dongle.', hp: 1, atk: 1, def: 1.1, verbs: ['upsells', 'invoices'], defeat: 'Tim Apple nods, unbothered. One more thing: he is coming with you.' },
  { id: 'tarbolts', minLevel: 15, name: 'Linux Tarbolts', desc: 'A kernel wizard in sandals, here to reject your patch.', hp: 1, atk: 1.1, def: 1, verbs: ['flames', 'rejects'], defeat: 'Linux Tarbolts grudgingly merges you, and joins the project.' },
  { id: 'freeman', minLevel: 20, name: 'Gordon Freeman', desc: 'Silent, bespectacled, and very good with a crowbar.', hp: 1.1, atk: 1.1, def: 1, verbs: ['crowbars', 'whacks'], defeat: 'Gordon Freeman nods without a word and falls in behind you.' },
  { id: 'sam', minLevel: 30, name: 'Sam Altermann', desc: 'Soft-spoken, holding a glowing orb that keeps getting bigger.', hp: 1.2, atk: 1.15, def: 1.1, verbs: ['out-scales', 'pivots at'], defeat: 'Sam Altermann smiles and announces a partnership with Clawd.' },
]
/** Of every encounter Clawd could meet a wild character in, the share that is one. */
export const LEGEND_CHANCE = 0.01
/** The pets chests, bosses and the road can drop: every pet but the wild characters and a boss's own. */
export const COMMON_PETS = Object.keys(PETS).filter(
  id => !LEGENDS.some(l => l.id === id) && !BIOMES.some(b => b.bosses.some(boss => boss.pets?.includes(id as PetId))),
) as PetId[]


/** Titles in rising order of renown; the hero holds the last one reached. */
export const TITLES: { renown: number; title: string }[] = [
  { renown: 0, title: 'the Newbie' },
  { renown: 20, title: 'the Wanderer' },
  { renown: 50, title: 'the Brave' },
  { renown: 100, title: 'the Bloodied' },
  { renown: 200, title: 'the Butcher' },
  { renown: 350, title: 'the Slayer' },
  { renown: 550, title: 'the Unbroken' },
  { renown: 800, title: 'the Dragonbane' },
  { renown: 1100, title: 'the Doombringer' },
  { renown: 1500, title: 'the Mythic' },
  { renown: 2000, title: 'the Worldbreaker' },
  { renown: 3000, title: 'the Eternal' },
  { renown: 5000, title: 'the Singularity' },
]

const isRarePlus = (s: Save) =>
  (['weapon', 'armor', 'trinket'] as const).every(slot => {
    const item = s.hero.gear[slot]
    return item !== null && ['rare', 'epic', 'legendary'].includes(item.rarity)
  })

export const ACHIEVEMENTS: { id: string; name: string; desc: string; check: (s: Save) => boolean }[] = [
  { id: 'first-blood', name: 'First Blood', desc: 'Win your first fight', check: s => s.stats.kills >= 1 },
  { id: 'centurion', name: 'Centurion', desc: 'Defeat 100 enemies', check: s => s.stats.kills >= 100 },
  { id: 'slayer', name: 'Slayer', desc: 'Defeat 1,000 enemies', check: s => s.stats.kills >= 1000 },
  { id: 'boss-hunter', name: 'Boss Hunter', desc: 'Defeat 10 bosses', check: s => s.stats.bosses >= 10 },
  { id: 'deep-diver', name: 'Deep Diver', desc: 'Reach depth 10', check: s => s.stats.maxDepth >= 10 },
  { id: 'abyssal', name: 'Abyssal', desc: 'Reach depth 25', check: s => s.stats.maxDepth >= 25 },
  { id: 'charmed', name: 'Charmed', desc: '10 lucky ticks in a row', check: s => s.stats.luckyStreak >= 10 },
  { id: 'cursed-coder', name: 'Cursed Coder', desc: '10 unlucky ticks in a row', check: s => s.stats.unluckyStreak >= 10 },
  { id: 'against-all-odds', name: 'Against All Odds', desc: 'Win a fight where every tick was unlucky', check: s => s.stats.wonAgainstOdds },
  { id: 'shiny', name: 'Shiny', desc: 'Find an epic item', check: s => s.stats.epicFound },
  { id: 'legend', name: 'Legend', desc: 'Find a legendary item', check: s => s.stats.legendaryFound },
  { id: 'fully-kitted', name: 'Fully Kitted', desc: 'Equip rare or better in every slot', check: isRarePlus },
  { id: 'back-on-your-feet', name: 'Back on Your Feet', desc: 'Recover from 10 knock-outs', check: s => s.stats.knockouts >= 10 },
  { id: 'dedicated', name: 'Dedicated', desc: 'Live through 1,000 ticks', check: s => s.stats.ticks >= 1000 },
  { id: 'veteran', name: 'Veteran', desc: 'Reach level 20', check: s => s.hero.level >= 20 },
]
