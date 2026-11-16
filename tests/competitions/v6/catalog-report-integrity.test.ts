import { it } from "vitest";
import {runDecisionRecommendation} from "@/lib/competitions/v6/model";
import {student} from "./decision-fixtures";
it("real catalog A1 assembles",async()=>{await runDecisionRecommendation(student(),{method:"rules"});});
