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
//
// Length matters too, and more than seems reasonable. StreamDiffusionV2's own
// documentation says the model "works better with long, detailed prompts", and
// it is right: a four-word label like "claymation" barely moves the picture,
// while a described scene — what the surface is made of, where the light comes
// from, what the edges look like — reaches it.
//
// So does naming the subject. The model's authors prompt it with whole scenes,
// not styles: "A domestic short-haired cat in tall grass, soft sunlight,
// natural fur texture, photorealistic". It is a scene rewriter, and a prompt
// that names only a medium gives it nothing to rewrite — it has to guess what
// is in front of the camera and usually guesses wrong, which is what "it looks
// nothing like the room" means. Every prompt here therefore opens with the
// people in the room and only then says how they are drawn.

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
    prompt: 'The people in the room drawn as flat two-dimensional cel animation from an American prime-time cartoon. Bright yellow skin, thick uniform black outlines around every shape, large white oval eyes with small black pupils, hair as one solid block of colour, simplified rounded features. Flat pastel walls behind them under an even light, no gradients, no shading, bold saturated primary colours, clean hand-inked edges.',
  },
  {
    id: 'claymation',
    name: 'Claymation',
    prompt: 'The people in the room as stop-motion figures modelled from soft plasticine clay. Fingerprints and thumb marks pressed into their faces and hands, tiny seams where the clay was joined, colours slightly matte and uneven. A handmade miniature set around them, warm studio key light from one side with gentle falloff, shallow depth of field, everything tactile and physical.',
  },
  {
    id: 'vintage-poster',
    name: 'Vintage Poster',
    prompt: 'The people in the room printed as a mid-century screen-printed travel poster. Three or four flat inks only, coarse halftone dots visible across every tone, heavy confident black linework, figures reduced to simplified geometric shapes. Aged cream paper with faint foxing and a soft edge where the ink did not fully register.',
  },
  {
    id: 'embroidery',
    name: 'Embroidery',
    prompt: 'The people in the room stitched as an embroidered patch on felt. Every shape filled with dense satin stitch in glossy thread, the raised needlework catching the light along each row, every edge bound by a tight overlocked border. Visible thread direction and sheen, felt fibre texture behind them, a handmade craft object.',
  },
  {
    id: 'render3d',
    name: '3D Render',
    prompt: 'The people in the room as characters from a modern 3D animated feature. Smooth subsurface-scattering skin, softly rounded stylised proportions, glossy highlights in the eyes, clean beveled edges on every surface. A large soft key light with warm bounce and a gentle rim, global illumination, shallow depth of field, ambient occlusion settling into the creases.',
  },
  {
    id: 'pixel',
    name: 'Pixel Art',
    prompt: 'The people in the room as sixteen-bit pixel art from a classic console game. A small palette of flat colours, hard chunky square pixels with no anti-aliasing, careful dithering across the gradients, dark outlines marking each form. Simple readable shapes, shading in two or three steps, a tiled background behind them.',
  },
  {
    id: 'adult-cartoon',
    name: 'Adult Cartoon',
    prompt: 'The people in the room drawn in the style of a hand-drawn adult animated sitcom. Wobbly confident ink lines of varying weight, flat colour fills with almost no shading, slightly exaggerated and unflattering proportions, heavy-lidded eyes and expressive eyebrows. A muted domestic palette, plain interior walls, deliberately unpolished linework.',
  },
  {
    id: 'anime',
    name: 'Anime',
    prompt: 'The people in the room as characters on a modern Japanese animation cel. Large expressive eyes with layered highlights and a soft gradient iris, clean thin ink lines, hair in distinct shaded clumps with a bright specular band, skin shaded in two flat tones with a crisp shadow edge. Cinematic backlighting, soft bloom, a painted background with gentle bokeh.',
  },
  {
    id: 'comic',
    name: 'Comic Book',
    prompt: 'The people in the room inked as American comic book art. Bold brush-inked outlines, deep cross-hatching in the shadows, dramatic high-contrast lighting across their faces, flat colours printed with visible Ben-Day dot texture. Strong graphic shapes, exaggerated dynamic poses, slightly off-register printing on newsprint.',
  },
  {
    id: 'oil',
    name: 'Oil Painting',
    prompt: 'The people in the room painted as a thick impasto oil painting on canvas. Visible loaded brush strokes standing proud of the surface, palette-knife edges catching the light, rich broken colour with warm and cool passages, canvas weave showing through the thinner areas. Painterly, expressive, lit like a gallery portrait.',
  },
  {
    id: 'watercolour',
    name: 'Watercolour',
    prompt: 'The people in the room painted as a loose watercolour on cold-pressed paper. Transparent washes bleeding softly into one another, granulating pigment settling into the paper tooth, hard edges where a wash dried, untouched white paper left as the highlights on their faces. Delicate and luminous, a faint graphite underdrawing still showing.',
  },
  {
    id: 'papercut',
    name: 'Paper Cut',
    prompt: 'The people in the room built as a layered paper-cut diorama. Each figure a separate sheet of coloured matte paper with clean scissors edges, stacked in depth and casting small soft shadows onto the layer beneath. Simplified silhouettes, no gradients, warm even light from above, visible paper fibre and a slight curl at the edges.',
  },
  {
    id: 'stainedglass',
    name: 'Stained Glass',
    prompt: 'The people in the room rendered as a stained glass window. Each shape a pane of richly coloured translucent glass separated by thick dark lead came, the glass streaked and bubbled and uneven in density. Brilliant light pouring through from behind saturates the colours and throws them forward. Bold simplified forms, strong black outlines, cathedral craftsmanship.',
  },
  {
    id: 'neon-noir',
    name: 'Neon Noir',
    prompt: 'The people in the room lit as a neon night scene in the rain. Deep black shadows cut by saturated magenta and cyan light, wet reflective surfaces doubling every source, volumetric haze in the air, hard coloured rim light along every edge of their faces and shoulders. Cinematic anamorphic flares, crushed blacks, heavy atmosphere.',
  },
  {
    id: 'lowpoly',
    name: 'Low Poly',
    prompt: 'The people in the room built from low-polygon 3D geometry. Every surface a large flat triangle with hard faceted edges and flat per-face shading, no smoothing and no texture detail. A restrained pastel palette, simple angular forms, clean studio lighting against a soft gradient background.',
  },
  {
    id: 'woodcut',
    name: 'Woodblock',
    prompt: 'The people in the room printed as a traditional woodblock print. Bold carved lines of uneven width, visible gouge marks where the block was cut away, flat areas of ink textured where the block did not print evenly, two or three colours registered slightly off from one another. Handmade paper with a soft deckle, strong graphic contrast.',
  },
  {
    id: 'rubber-hose',
    name: 'Rubber Hose',
    prompt: 'The people in the room drawn as 1930s rubber-hose cartoon characters. Bendy boneless arms and legs with no elbows or knees, oversized white gloves, pie-cut eyes with a wedge missing, wide toothy grins, bodies built from soft tubes and circles. Rendered as a scratchy black-and-white film print with visible grain, dust, gate weave and a faint sepia wash.',
  },
  {
    id: 'saturday-cartoon',
    name: 'Saturday Morning',
    prompt: 'The people in the room drawn as characters from a Saturday morning children\'s cartoon. Chunky rounded shapes, thick even outlines, cheerful saturated colours, big eyes with a single round highlight, simple two-tone shading. A flat painted background of soft clouds and bright fields, everything friendly and uncluttered.',
  },
  {
    id: 'mushroom-forest',
    name: 'Mushroom Forest',
    prompt: 'The people in the room standing in a giant mushroom forest. Enormous glowing toadstools with speckled caps arch overhead, bioluminescent spores drift through the air, soft turquoise and violet light seeps between the stems, pale fungal gills glow from below. Damp moss underfoot, volumetric shafts of light, lush and dreamlike.',
  },
  {
    id: 'psychedelic',
    name: 'Psychedelic',
    prompt: 'The people in the room dissolving into a psychedelic poster. Melting rainbow contours flow around them in concentric bands, complementary colours vibrate against one another, every edge trails away into liquid swirls and paisley curls, repeating fractal patterns bloom out of the background. Hand-drawn 1960s ink linework, impossibly saturated.',
  },
  {
    id: 'blacklight',
    name: 'Blacklight',
    prompt: 'The people in the room lit only by ultraviolet blacklight. Fluorescent pigment glows electric magenta, acid green and cyan against total darkness, every other surface swallowed by black. Hand-painted dayglo poster patterns bloom across their skin and clothes, edges haloed with a soft glow.',
  },
  {
    id: 'slime',
    name: 'Slime',
    prompt: 'The people in the room coated in thick translucent slime. Glossy viscous green goo drips in long strands from every edge, catching bright specular highlights, air bubbles suspended inside it, surfaces stretched and rounded by the coating. Wet, sticky, exaggerated, lit hard from above.',
  },
  {
    id: 'felt-puppet',
    name: 'Felt Puppet',
    prompt: 'The people in the room as soft felt puppets. Bodies of brightly coloured fleece with visible fuzz and stitched seams, ping-pong ball eyes glued slightly crooked, wide felt mouths, yarn hair. A cardboard and fabric set behind them under warm television studio lighting, everything handmade and a little lopsided.',
  },
  {
    id: 'storybook',
    name: 'Storybook',
    prompt: 'The people in the room illustrated as a page from a children\'s picture book. Soft gouache washes with visible brush texture, gently wobbling ink contours, warm muted colours, simplified friendly faces, tiny decorative details tucked into the corners. Cream paper showing through, printed slightly soft.',
  },
  {
    id: 'toon-shade',
    name: 'Toon Shade',
    prompt: 'The people in the room rendered with hard cel shading. Colour banded into two or three flat steps with a crisp boundary between light and shadow, thick dark contour lines traced around every silhouette, a bright rim light separating them from the background, no gradients anywhere. Clean, graphic, like a video game cutscene.',
  },
  {
    id: 'candy',
    name: 'Candy',
    prompt: 'The people in the room made of confectionery. Glossy boiled-sugar surfaces in translucent pinks and greens, swirled candy-cane stripes, sprinkles caught in the glaze, soft marshmallow forms and hard glassy highlights. A pastel sugar-dusted background, lit bright and sweet.',
  },
  {
    id: 'mycelium',
    name: 'Mycelium',
    prompt: 'The people in the room overgrown with mycelium. Fine white fungal threads lace across their skin and clothes in branching networks, small pale mushrooms sprout from the folds, a faint bioluminescence pulses along the strands. Damp earthy colours, macro detail on the filaments, quiet and slowly spreading.',
  },
  {
    id: 'aurora',
    name: 'Aurora',
    prompt: 'The people in the room beneath an aurora. Ribbons of green and violet light ripple across the whole sky and wash over them, cold blue shadows fill everything the light does not reach, stars burn through the gaps, the air itself glowing faintly. Long-exposure smoothness, deep saturated night colour.',
  },
];

export const PROMPT_BY_ID = new Map(STYLE_PROMPTS.map((entry) => [entry.id, entry]));
