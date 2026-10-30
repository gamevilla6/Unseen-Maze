export type LevelDef = {
  id: number;
  name: string;
  subtitle: string;
  description: string;
  size: number;
  theme: 'standard' | 'vault' | 'crystal' | 'water' | 'cyber' | 'void';
  difficulty: 'Easy' | 'Medium' | 'Hard' | 'Expert';
  tier: 'easy' | 'medium' | 'hard' | 'expert';
  region: string;
  corridorWidth: number;
};

export const TOTAL_LEVELS = 99;
export const LEVELS: LevelDef[] = Array.from({ length: TOTAL_LEVELS }, (_, i) => {
  const id = i + 1;
  if (id <= 33) {
    const chapter = Math.floor(i / 11);
    const names = ['The First Echo', 'Silent Passage', 'The Listening Path'];
    return {
      id, name: id === 1 ? 'The First Echo' : `Whispering Caves · ${String(id).padStart(2, '0')}`,
      subtitle: names[chapter]!,
      description: 'Wide, straight corridors and slow drifting stones. Learn to pulse, listen and pass obstacles; the generous step budget leaves room to explore.',
      size: 3 + Math.floor(i / 11), theme: 'standard', tier: 'easy',
      difficulty: 'Easy', region: 'Whispering Caves', corridorWidth: 3.2,
    };
  }
  if (id <= 66) {
    const local = id - 34;
    const vault = local % 2 === 0;
    const region = vault ? 'Subterranean Vault' : 'Crystal Cavern';
    return {
      id, name: `${region} · ${String(id).padStart(2, '0')}`,
      subtitle: vault ? 'Concrete remembers' : 'Refractive echoes',
      description: vault
        ? 'Tight right-angle passages return sharp, brief echoes. Hidden spikes guard dead ends; plan before taking another step.'
        : 'Crystal walls refract your pulse into delayed secondary echoes. Their amplified range reveals passages around corners; distinguish their origins from your own.',
      size: 6 + Math.floor(local / 11), theme: vault ? 'vault' : 'crystal', tier: 'medium',
      difficulty: 'Medium', region, corridorWidth: 2.4,
    };
  }
  if (id <= 90) {
    const local = id - 67;
    const water = local % 2 === 0;
    const region = water ? 'Sunken Catacombs' : 'Neon Cyber-Corridors';
    return {
      id, name: `${region} · ${String(id).padStart(2, '0')}`,
      subtitle: water ? 'Tread softly' : 'You are not alone',
      description: water
        ? 'Waterlogged crypts swallow hurried footsteps. Hold Shift or use stealth to avoid ripples that dampen sonar. Spikes lurk in the side passages.'
        : 'Security drones investigate sonar waves while laser grids shift on a timed cycle. Cross when the lasers dim and do not call a drone to your position.',
      size: 8 + Math.floor(local / 8), theme: water ? 'water' : 'cyber', tier: 'hard',
      difficulty: 'Hard', region, corridorWidth: 2.2,
    };
  }
  return {
    id, name: `The Void Labyrinth · ${id}`,
    subtitle: id === 99 ? 'The final silence' : 'The darkness moves',
    description: 'No walls, no stable map. Invisible gravitational paths rearrange every 30 seconds. A safe route remains, but only an echo can show you where to walk.',
    size: 9 + Math.floor((id - 91) / 3), theme: 'void', tier: 'expert',
    difficulty: 'Expert', region: 'The Void Labyrinth', corridorWidth: 2.1,
  };
});
