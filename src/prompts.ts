// Prompt presets for the diffusion engine.
//
// These are not looks in the shader sense — nothing here is a parameter. Each
// is a sentence handed to a model that redraws the frame, which is the one
// thing a shader fundamentally cannot do: it has no idea there is a person in
// the picture.
//
// Wording matters more than it looks. Naming a medium ("cel animation",
// "stop-motion") steers a model far harder than naming a franchise, and stays
// clear of reproducing a specific studio's protected characters.

export interface StylePrompt {
  id: string;
  name: string;
  prompt: string;
}

export const NEGATIVE_PROMPT =
  'blurry, low quality, distorted, deformed, watermark, text, extra limbs';

export const STYLE_PROMPTS: readonly StylePrompt[] = [
  {
    id: 'yellow-cartoon',
    name: 'Yellow Cartoon',
    prompt: 'flat 2D cel animation, thick black outlines, bright yellow skin, simple shapes, saturated primary colours, american tv cartoon',
  },
  {
    id: 'adult-cartoon',
    name: 'Adult Cartoon',
    prompt: 'scratchy 2D cartoon, wobbly hand-drawn outlines, pale flat colours, big oval eyes, sci-fi adult animation',
  },
  {
    id: 'anime',
    name: 'Anime',
    prompt: 'anime key visual, cel shaded, crisp linework, large expressive eyes, vivid colour grading, studio animation still',
  },
  {
    id: 'claymation',
    name: 'Claymation',
    prompt: 'stop-motion claymation, plasticine figures, visible fingerprints in the clay, soft studio lighting, shallow depth of field',
  },
  {
    id: 'render3d',
    name: '3D Render',
    prompt: 'polished 3D render, subsurface scattering, soft global illumination, octane render, pixar style character',
  },
  {
    id: 'oil',
    name: 'Oil Painting',
    prompt: 'thick oil painting, visible impasto brush strokes, canvas texture, rembrandt lighting, gallery photograph',
  },
  {
    id: 'comic',
    name: 'Comic Book',
    prompt: 'inked comic book panel, heavy black shadows, ben-day dot shading, bold primary colours, retro print',
  },
  {
    id: 'watercolour',
    name: 'Watercolour',
    prompt: 'loose watercolour painting, bleeding pigment, wet paper texture, soft washes, white paper showing through',
  },
  {
    id: 'pixel',
    name: 'Pixel Art',
    prompt: 'pixel art, limited 16 colour palette, chunky pixels, dithering, retro game sprite',
  },
  {
    id: 'lowpoly',
    name: 'Low Poly',
    prompt: 'low poly 3D, flat shaded triangles, faceted geometry, pastel gradient palette, isometric render',
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    prompt: 'cyberpunk night, neon rim lighting, wet reflective surfaces, holographic signage, cinematic teal and magenta',
  },
  {
    id: 'woodcut',
    name: 'Woodcut',
    prompt: 'japanese woodblock print, flat colour fields, visible carving marks, muted natural pigments, ukiyo-e composition',
  },
];

export const PROMPT_BY_ID = new Map(STYLE_PROMPTS.map((entry) => [entry.id, entry]));
