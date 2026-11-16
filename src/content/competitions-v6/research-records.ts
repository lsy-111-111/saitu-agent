import { historicalSoftwareBatch04 } from "./researched-historical-software-batch04";
import { learningResearchD3 } from "./researched-learning-d3";
import { learningResearchD2 } from "./researched-learning-d2";
import { learningResearchD1 } from "./researched-learning-d1";
import { softwareMathResearchC7 } from "./researched-software-math-c7";
import { softwareMathResearchC6 } from "./researched-software-math-c6";
import { softwareMathResearchC2 } from "./researched-software-math-c2";
import { softwareMathResearchC3 } from "./researched-software-math-c3";
import { softwareMathResearchC4 } from "./researched-software-math-c4";
import { softwareMathResearchC5 } from "./researched-software-math-c5";
import type { ResearchedContent } from "./research-types";
import { researchBatch01 } from "./researched-batch-01";
import { researchBatch02 } from "./researched-batch-02";
import { researchBatch03 } from "./researched-batch-03";

import { researchBatch04 } from "./researched-batch-04";

import { researchBatch05 } from "./researched-batch-05";

import { engineeringResearchA } from "./researched-engineering-a";

import { researchBatch06 } from "./researched-batch-06";

import { researchBatch07 } from "./researched-batch-07";

import { researchBatch08 } from "./researched-batch-08";

import { artsBusinessResearchB } from "./researched-arts-business-b";

import { softwareMathResearchC } from "./researched-software-math-c";

export const researchedContents: ResearchedContent[] = [...historicalSoftwareBatch04,...learningResearchD3, ...learningResearchD2, ...learningResearchD1, ...researchBatch01, ...researchBatch02, ...researchBatch03, ...researchBatch04, ...researchBatch05, ...researchBatch06, ...researchBatch07, ...researchBatch08, ...softwareMathResearchC, ...softwareMathResearchC2, ...softwareMathResearchC3, ...softwareMathResearchC4, ...softwareMathResearchC5, ...softwareMathResearchC6, ...softwareMathResearchC7, ...artsBusinessResearchB, ...engineeringResearchA.map(content => ({ ...content, authorAgentId: content.authorAgentId ?? "/root" }))];
