export interface BasicProfile {
  name: string;
  age: string;
  gender: string;
  pronouns: string;
}

export type MessageRole = 'user' | 'model' | 'system';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  image?: string;
  timestamp: number;
}

export interface UserProfile {
  psych_summary: string;
  hard_gates: {
    relationship_intent: string;
    gender_preference: string;
    age_range: string;
    location_radius: string;
  };
  lifestyle: {
    social_battery: string;
    substance_habits: string;
    ambition_mode: string;
    sleep_chronotype: string;
  };
  psych_profile: {
    conflict_style: string;
    love_language_give: string;
    love_language_receive: string;
    communication_frequency: string;
  };
  shared_glue: {
    spending_style: string;
    political_lean: string;
    humor_style: string;
  };
  deal_breakers: string[];
  green_flags: string[];
}

export interface SoulPortrait {
  subject_description: string;
  clothing_and_style: string;
  action_and_pose: string;
  emotional_atmosphere: string;
  symbolic_object: string;
  lighting_style: string;
  color_palette: string[];
}

export interface MusePortrait {
  muse_description: string;
  interaction_with_viewer: string;
  clothing_vibe: string;
  setting_and_mood: string;
  lighting_and_texture: string;
  color_palette: string[];
}
