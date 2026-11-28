/**
 * MeasuredElement — the engine's contract with rules.
 *
 * The engine measures every element ONCE (slow, cached per model version) into
 * this shape. Rules can only refer to what is here. Anything not applicable to
 * an element is simply absent (undefined), which is what drives `onMissing`.
 *
 * All values are SI: metres, m2, m3, kg. Units on BoQ lines are converted at output.
 */

import type { ElementFamily } from "./families";
import type { RegisteredUnit } from "./units";

/**
 * A unit from the registry (units.ts: nr, item, sum, h, mm, cm, m, km, in, ft, yd, mm2, cm2, m2, ft2, yd2, l, m3,
 * ft3, yd3, g, kg, t, lb). The schema accepts any text so that a run of an older preset still reads; the preset
 * check refuses a unit not in the registry or of the wrong dimension (review A-28).
 */
export type Unit = RegisteredUnit | (string & {});

export type Provenance = "reported" | "geometry" | "derived" | "user";

/**
 * How a measured value was found (review C-10). Stated: `property` (a property or quantity set; `from` names
 * "Set.Property"), `attribute` (the element's own attribute, e.g. OverallHeight), `layer_set` (the material
 * layer set's total). Geometry: `mesh` (the closed body's volume), `parts` (its parts' bodies), `faces` (the
 * mean of its two measured faces), `sides` (volume / mean side area), `box` (an oriented-box extent), `extent`
 * (an axis-aligned extent), `up_faces` (the faces looking up), `surface` (an open surface model's area),
 * `vertical_faces` (the faces standing up, less contacts). Computed: `volume_thickness`, `volume_area`,
 * `plus_openings` (net + the openings), `less_openings`, `openings` (the openings' edges), `surface_volume`
 * (a prism's perimeter from its surface and volume), `box_sides` (2 x (length + width) x height), `same`
 * (repeats the field in `uses`). A breakdown part's own: `area_thickness` (a layer's volume: the element's area x
 * the layer's thickness), `face` (one face's area; `from` its side). `profile` (nominal kg/m of the section in `from`), `material` (the density of
 * the dictionary term in `from`), `name` (read from the element's name).
 */
export type MeasuredBasis =
  | "property" | "attribute" | "layer_set"
  | "mesh" | "parts" | "faces" | "sides" | "box" | "extent" | "up_faces" | "surface" | "vertical_faces"
  | "volume_thickness" | "volume_area" | "plus_openings" | "less_openings" | "openings" | "surface_volume"
  | "box_sides" | "same" | "area_thickness" | "face" | "profile" | "material" | "name";

/** Where one measured value came from (review C-10): what a line's "How it is calculated" shows per element. */
export interface MeasuredSource {
  basis: MeasuredBasis;
  /** The set and property it was read from ("PSet_Revit_Dimensions.Volume"), a profile or a material term. */
  from?: string;
  /** The fields it was computed from or checked against (an area from volume / thickness). */
  uses?: MeasuredField[];
  /** The geometry's value, when a stated value is used and the geometry differs. */
  geometry?: number;
  /** The stated value, when the geometry's is used instead (a contradiction, a unit error). */
  stated?: number;
  /** The `contradiction` question whose answer chose the value. */
  question?: string;
}

export interface Face {
  side: "a" | "b" | "top" | "bottom" | "edge" | "end";
  gross_area: number;
  net_area: number;
  /** Room this face bounds (computed from geometry: the room's surface lying on the face). */
  space?: string;
  space_name?: string;
  /** Dictionary term of the room, e.g. "space.bathroom". */
  space_type?: string;
  is_external?: boolean;
  /** Outward normal, for orientation-based rules (facade direction). */
  normal?: [number, number, number];
  /**
   * The outermost material layer on this face (dictionary term and the file's name), from the layer
   * set's order and direction (A-11): what a finish rule looks for, e.g. plasterboard to paint.
   */
  layer_material?: string;
  layer_material_raw?: string;
}

export interface Opening {
  /** GlobalId of the IfcOpeningElement. */
  guid?: string;
  /** recess: does not go through the host (IfcOpeningElement RECESS, or ObjectType "Recess"); not part of
   *  net areas or room openings, deducted only by `what: "recesses"`. */
  kind: "door" | "window" | "void" | "recess";
  width: number;
  height: number;
  area: number;
  /** Depth of the opening through the host = reveal depth. */
  depth?: number;
  perimeter: number;
  filling_guid?: string;
  filling_class?: string;
}

export interface Embedded {
  guid: string;
  ifc_class: string;
  volume: number;
  area?: number;
  model?: string;
}

export interface Layer {
  index: number;
  material: string;               // normalised by the dictionary
  material_raw: string;           // as in the IFC
  thickness: number;
  area: number;
  volume: number;
  function?: "structure" | "insulation" | "finish" | "membrane" | "air_gap" | "other";
}

/**
 * Values of the whole building, for formulas as `building.<field>` (all models of a run together).
 * Taken from the IFC building's quantities (Qto_BuildingBaseQuantities) where present, otherwise
 * derived from the elements; `provenance` says which, `notes` how.
 */
export interface BuildingMeasures {
  /** Sum of floor slab plan areas (derived), or the reported gross floor area. */
  gross_floor_area?: number;
  /** Sum of room floor areas (derived), or the reported net floor area. */
  net_floor_area?: number;
  /** Largest floor slab plan area of one storey (derived), or the reported footprint. */
  footprint_area?: number;
  /** Floor slab plan area x storey height, summed over storeys (derived, approximate), or reported. */
  gross_volume?: number;
  /** Sum of room volumes. */
  space_volume?: number;
  /** Highest element top less lowest element base (derived), or reported. */
  height?: number;
  storeys?: number;
  provenance: Partial<Record<string, "reported" | "derived">>;
  notes: string[];
}

export interface MeasuredElement {
  /* ---- identity ---------------------------------------------------- */
  guid: string;
  model_id: string;
  discipline: string;             // "mep" for distribution elements, else the model's guess (architecture | structure | infrastructure | unknown)
  ifc_class: string;              // normalised (IfcWallStandardCase -> IfcWall; IFC2x3 IfcFlowSegment typed IfcDuctSegmentType -> IfcDuctSegment)
  ifc_class_raw: string;
  predefined_type?: string;
  family: ElementFamily;          // measurement family (linear, planar, ...)
  name?: string;
  family_name?: string;           // authoring-tool family, e.g. Revit "M_Fixed" (from the dictionary extractor)
  type_name?: string;
  material?: string;              // main material: dictionary term (thickest non-air layer for layer sets)
  element_type?: string;          // dictionary term from the type name, e.g. "wall.party"
  space_type?: string;            // spaces: dictionary term from the room name, e.g. "space.bathroom"
  materials: string[];
  system?: string;                // MEP system name / type
  profile?: string;               // section designation, e.g. "W310X60", "IPE200"
  nominal_size?: string;          // e.g. "DN50", "200x100"
  strength_class?: string;        // e.g. "C30/37", "MB30" (from names)
  material_raw?: string;          // main material name as in the IFC

  /* ---- location & status ------------------------------------------- */
  site?: string;
  building?: string;
  storey?: string;
  storey_elevation?: number;
  spaces: string[];
  zone?: string;
  status: "new" | "existing" | "demolish" | "temporary";
  design_option?: string;

  /* ---- common flags ------------------------------------------------ */
  is_external?: boolean;
  load_bearing?: boolean;

  /* ---- dimensions -------------------------------------------------- */
  length?: number;
  width?: number;
  height?: number;
  thickness?: number;
  depth?: number;
  diameter?: number;
  cross_section_area?: number;
  slope?: number;                 // degrees
  elevation_base?: number;
  elevation_top?: number;
  profile_girth?: number;         // developed width of a profile

  /* ---- areas ------------------------------------------------------- */
  gross_area?: number;            // main face, before openings
  net_area?: number;              // main face, after all openings
  footprint_area?: number;        // plan projection
  developed_area?: number;        // true sloped / unfolded area
  /**
   * Footings: the faces standing up (sides and ends) less the part against another solid (the next
   * footing, a wall, a slab edge), from the closed mesh; else 2 x (length + width) x height (A-10).
   * What formwork to the sides of a footing covers.
   */
  vertical_face_area?: number;
  faces: Face[];

  /* ---- rooms (IfcSpace) -------------------------------------------- */
  floor_area?: number;
  ceiling_area?: number;
  /** Room wall surface, before openings (perimeter x height for a simple room). */
  wall_area?: number;
  /** Room wall surface less the doors and windows in the walls bounding it. */
  wall_area_net?: number;
  /** Perimeter less the widths of the doors in the walls bounding it. */
  skirting_length?: number;
  /** Elements whose faces bound the room. */
  bounded_by?: string[];

  /* ---- volumes, perimeters, mass ----------------------------------- */
  gross_volume?: number;
  net_volume?: number;
  perimeter?: number;
  /**
   * The perimeter split in two (A-13): the edges of the openings through the element (2 x (width +
   * height) of each, plan size; recesses excluded) and the rest, the outer edge. A reported perimeter
   * is taken as both together (exporter-dependent, noted). Both absent when the perimeter is.
   */
  perimeter_outer?: number;
  perimeter_openings?: number;
  mass?: number;                  // reported mass, if any
  nominal_mass_per_length?: number;
  density?: number;

  /* ---- reinforcement ----------------------------------------------- */
  bar_diameter?: number;
  bar_count?: number;
  bar_length?: number;            // per bar

  /* ---- MEP --------------------------------------------------------- */
  insulation_thickness?: number;
  connection_count?: number;

  /* ---- parts & relationships --------------------------------------- */
  openings: Opening[];
  /** Linear elements (columns, beams, members) passing through this planar element: the solid
   *  volume they share with it, and that volume over this element's thickness (the area they take
   *  out of its face). Rooms: the columns standing in them, area = shared volume / room height.
   *  Used by `embedded` deductions. `model` is set when the element is in another model of a
   *  federation. */
  embedded?: Embedded[];
  layers: Layer[];
  host_guid?: string;
  parent_guid?: string;
  child_guids: string[];

  /** Classification references already in the IFC (used by maps with source "ifc"). */
  ifc_classifications?: { system?: string; code?: string; title?: string }[];

  /* ---- everything else --------------------------------------------- */
  /** All property sets flattened: "Pset_WallCommon.FireRating" -> "EI60". */
  props: Record<string, string | number | boolean | null>;

  /* ---- trust ------------------------------------------------------- */
  /** Where each numeric value came from, keyed by MeasuredField. */
  provenance: Partial<Record<string, Provenance>>;
  /** Each numeric value's source in detail (review C-10), keyed by MeasuredField; fields measured outside the main path (rooms, aggregates) may have none. */
  sources?: Partial<Record<MeasuredField, MeasuredSource>>;
  /** Reported vs geometry disagreements found during verification. */
  warnings: string[];
  /**
   * Stated values taken as an exporter unit error: the file's value is 10^±3 or 10^±6 times the closed
   * mesh's (within 2 %), so the geometry's value is used for that field. The factor is stated / measured
   * (1000 = the file says 1000 times the geometry). Lines measuring such an element carry a note.
   */
  unit_scale?: Partial<Record<MeasuredField, number>>;
  /**
   * Open `contradiction` questions about this element's stated quantities (their ids): its quantity
   * rests on the engine's choice until someone answers, so the lines it feeds are `toConfirm` (A-05).
   */
  contradictions?: string[];
  /** The `contradiction` answers (question ids) that decided how this element was measured (A-06). */
  decisions?: string[];
}

/**
 * Numeric fields rules may use as variables in formulas, selectors and bands.
 * Written out explicitly so the JSON Schema (for the Python engine) can list them;
 * the check below fails to compile if this list drifts from MeasuredElement.
 */
export type MeasuredField =
  | "storey_elevation"
  | "length" | "width" | "height" | "thickness" | "depth" | "diameter"
  | "cross_section_area" | "slope" | "elevation_base" | "elevation_top" | "profile_girth"
  | "gross_area" | "net_area" | "footprint_area" | "developed_area" | "vertical_face_area"
  | "floor_area" | "ceiling_area" | "wall_area" | "wall_area_net" | "skirting_length"
  | "gross_volume" | "net_volume" | "perimeter" | "perimeter_outer" | "perimeter_openings"
  | "mass" | "nominal_mass_per_length" | "density"
  | "bar_diameter" | "bar_count" | "bar_length"
  | "insulation_thickness" | "connection_count";

type _NumericKeys = {
  [K in keyof MeasuredElement]-?: NonNullable<MeasuredElement[K]> extends number ? K : never;
}[keyof MeasuredElement];
type _Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _measuredFieldsInSync: _Same<MeasuredField, _NumericKeys> = true;
void _measuredFieldsInSync;
