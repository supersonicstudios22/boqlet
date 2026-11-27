import { UNITS, type RegisteredUnit } from "@ifc-boq/types";

/**
 * The units a person can pick (a manual line, an item's or a slot's unit, a dictionary capture): the unit
 * registry's ids in its order, grouped by what they measure (review A-28, B-15). The engine refuses any other;
 * their labels are `messages/<locale>/units.json`, keyed by the same ids.
 */
export const UNIT_CHOICES = Object.keys(UNITS) as RegisteredUnit[];
