import rawEducationContent from "../../../../content/education/foundation-articles.json";
import { parseEducationContent } from "./education-content-schema";

export const educationContent = parseEducationContent(rawEducationContent);
