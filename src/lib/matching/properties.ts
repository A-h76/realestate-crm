import type { Lead, Property, PropertyStatus } from "@prisma/client";

export type PropertyMatchReason = {
  factor: string;
  detail: string;
  points: number;
};

export type ScoredPropertyMatch = {
  property: Property;
  matchScore: number;
  reasons: PropertyMatchReason[];
  caution: string | null;
};

function num(value: { toString(): string } | number | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value.toString());
  return Number.isNaN(n) ? null : n;
}

function clamp(n: number) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function areaClose(a?: string | null, b?: string | null) {
  if (!a || !b) return false;
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  return na === nb || na.includes(nb) || nb.includes(na);
}

function dhaFamily(a?: string | null) {
  return Boolean(a && /\bdha\b/i.test(a));
}

const AVAILABLE: PropertyStatus[] = ["AVAILABLE"];

export function scorePropertyMatch(lead: Lead, property: Property): ScoredPropertyMatch {
  const reasons: PropertyMatchReason[] = [];
  let score = 0;
  const budgetMin = num(lead.budgetMin);
  const budgetMax = num(lead.budgetMax);
  const price = num(property.price) ?? 0;
  const sizePrefMin = num(lead.sizePrefMin);
  const sizePrefMax = num(lead.sizePrefMax);
  const size = num(property.size);

  if (lead.propertyTypePref && property.propertyType === lead.propertyTypePref) {
    score += 16;
    reasons.push({ factor: "Type", detail: property.propertyType, points: 16 });
  } else if (!lead.propertyTypePref) {
    score += 8;
  }

  if (lead.propertyPurpose && property.purpose === lead.propertyPurpose) {
    score += 12;
    reasons.push({ factor: "Purpose", detail: property.purpose, points: 12 });
  } else if (!lead.propertyPurpose) {
    score += 6;
  }

  if (lead.preferredArea && areaClose(lead.preferredArea, property.area)) {
    score += 18;
    reasons.push({ factor: "Area", detail: property.area ?? lead.preferredArea, points: 18 });
  } else if (lead.preferredArea && dhaFamily(lead.preferredArea) && dhaFamily(property.area)) {
    score += 13;
    reasons.push({ factor: "Area", detail: `${property.area} (DHA family)`, points: 13 });
  } else if (lead.preferredArea && property.area) {
    reasons.push({ factor: "Area", detail: `${property.area} vs ${lead.preferredArea}`, points: 0 });
  }

  if (budgetMin != null && budgetMax != null && price > 0) {
    if (price >= budgetMin && price <= budgetMax) {
      score += 16;
      reasons.push({ factor: "Budget", detail: "Inside stated budget", points: 16 });
    } else {
      const span = Math.max(budgetMax - budgetMin, 1);
      const over = price > budgetMax ? (price - budgetMax) / span : (budgetMin - price) / span;
      const pts = Math.max(0, 16 - Math.round(over * 40));
      score += pts;
      reasons.push({
        factor: "Budget",
        detail: price > budgetMax ? "Slightly above budget" : "Below minimum budget",
        points: pts,
      });
    }
  }

  if (lead.sizeUnitPref && property.sizeUnit === lead.sizeUnitPref && size != null) {
    const inRange =
      (sizePrefMin == null || size >= sizePrefMin) && (sizePrefMax == null || size <= sizePrefMax);
    const pts = inRange ? 8 : 3;
    score += pts;
    reasons.push({
      factor: "Size",
      detail: `${size} ${property.sizeUnit}`,
      points: pts,
    });
  }

  if (lead.bedroomPref && property.bedrooms != null) {
    const pts = property.bedrooms === lead.bedroomPref ? 6 : Math.abs(property.bedrooms - lead.bedroomPref) === 1 ? 3 : 0;
    score += pts;
    reasons.push({ factor: "Bedrooms", detail: String(property.bedrooms), points: pts });
  }

  if (lead.bathroomPref && property.bathrooms != null) {
    const pts = property.bathrooms === lead.bathroomPref ? 5 : Math.abs(property.bathrooms - lead.bathroomPref) === 1 ? 3 : 0;
    score += pts;
    reasons.push({ factor: "Bathrooms", detail: String(property.bathrooms), points: pts });
  }

  if (lead.furnishedPref && property.furnishedStatus) {
    const pts = property.furnishedStatus.toLowerCase() === lead.furnishedPref.toLowerCase() ? 3 : 0;
    score += pts;
    if (pts) reasons.push({ factor: "Furnished", detail: property.furnishedStatus, points: 3 });
  }

  if (AVAILABLE.includes(property.status)) {
    score += 5;
    reasons.push({ factor: "Availability", detail: "Available", points: 5 });
  }

  if (lead.timeline && /immediate|30|45|60/i.test(lead.timeline) && property.status === "AVAILABLE") {
    score += 5;
    reasons.push({ factor: "Timeline", detail: lead.timeline, points: 5 });
  }

  let caution: string | null = null;
  if (property.status !== "AVAILABLE") caution = `Listing is ${property.status.toLowerCase()}`;
  if (budgetMax != null && price > budgetMax * 1.1) caution = "Price is above the stated budget band";

  const factorOrder = ["Area", "Budget", "Size", "Bedrooms", "Bathrooms", "Timeline", "Availability", "Type", "Purpose", "Furnished"];

  return {
    property,
    matchScore: clamp(score),
    reasons: reasons
      .filter((r) => r.points > 0)
      .sort((a, b) => factorOrder.indexOf(a.factor) - factorOrder.indexOf(b.factor))
      .slice(0, 6),
    caution,
  };
}

export function filterAndScoreProperties(lead: Lead, properties: Property[]): ScoredPropertyMatch[] {
  const filtered = properties.filter((property) => {
    if (property.deletedAt) return false;
    if (property.status === "WITHDRAWN" || property.status === "SOLD" || property.status === "RENTED") {
      return false;
    }
    if (lead.propertyPurpose && property.purpose !== lead.propertyPurpose) return false;
    if (lead.propertyTypePref && property.propertyType !== lead.propertyTypePref) return false;
    return true;
  });

  return filtered
    .map((property) => scorePropertyMatch(lead, property))
    .filter((row) => row.matchScore >= 35)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 8);
}
