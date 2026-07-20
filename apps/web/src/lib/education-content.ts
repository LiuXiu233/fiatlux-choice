import rawExpansionContent from "../../../../content/education/expansion-articles.json";
import rawFoundationContent from "../../../../content/education/foundation-articles.json";
import { mergeEducationContentPackages } from "./education-content-library";
import { parseEducationContent } from "./education-content-schema";

export { mergeEducationContentPackages } from "./education-content-library";

export const educationContentPackages = [
  parseEducationContent(rawFoundationContent),
  parseEducationContent(rawExpansionContent),
] as const;

export const educationContent = mergeEducationContentPackages(educationContentPackages);
