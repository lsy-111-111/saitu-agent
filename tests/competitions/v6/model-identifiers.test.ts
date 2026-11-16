import { expect, it } from "vitest";
import { createModelIdentifierCodec } from "@/lib/competitions/v6/model-identifiers";

it("roundtrips all provenance references without interpreting user prose as identifiers", () => {
  const codec = createModelIdentifierCodec({candidates:["long-candidate"],series:["long-series"],facts:["long-fact"],students:["long-student"]});
  const payload={candidates:[{itemId:"long-candidate",seriesId:"long-series",facts:[{id:"long-fact",text:"long-candidate"}]}],profile:{facts:[{id:"long-student",value:"@F0"}]},recommendations:[{itemId:"long-candidate",reasons:[{text:"@C0",studentFactIds:["long-student"],competitionFactIds:["long-fact"]}]}]};
  const encoded=codec.encode(payload) as typeof payload;
  expect(encoded.candidates[0].itemId).toBe("@C0");
  expect(encoded.candidates[0].facts[0].text).toBe("long-candidate");
  expect(codec.decode(encoded)).toEqual(payload);
  expect(codec.decode({itemId:"@C99"})).toEqual({itemId:"@C99"});
});

it("uses stable identifiers under input permutations and rejects ambiguous namespaces", () => {
  const first=createModelIdentifierCodec({candidates:["b","a"],series:[],facts:[],students:[]});
  const second=createModelIdentifierCodec({candidates:["a","b"],series:[],facts:[],students:[]});
  expect(first.encode({itemIds:["a","b"]})).toEqual(second.encode({itemIds:["a","b"]}));
  expect(()=>createModelIdentifierCodec({candidates:["a"],series:["a"],facts:[],students:[]})).toThrow("ambiguous_model_identifier");
});

it.each([
  ["allowedItemIds", "long-candidate", "@C0"],
  ["candidateIds", "long-candidate", "@C0"],
  ["focusItemIds", "long-candidate", "@C0"],
  ["lastValidModelItemIds", "long-candidate", "@C0"],
  ["supersedesRecordIds", "long-candidate", "@C0"],
  ["legacyRecordIds", "long-candidate", "@C0"],
  ["retractedFactIds", "long-student", "@P0"],
  ["supersedesFactIds", "long-student", "@P0"],
  ["addedFactIds", "long-student", "@P0"],
  ["removedFactIds", "long-student", "@P0"],
  ["supersedes", "long-fact", "@F0"],
  ["conflictsWith", "long-fact", "@F0"],
  ["unresolvedFactIds", "long-fact", "@F0"],
  ["unresolvedBoundaryFactIds", "long-fact", "@F0"],
  ["sourceIds", "long-fact", "@F0"],
  ["unresolvedSourceIds", "long-fact", "@F0"],
  ["ambiguousSourceIds", "long-fact", "@F0"],
])("keeps known relation endpoint %s consistent with its encoded entity ID", (field, id, alias) => {
  const codec = createModelIdentifierCodec({ candidates: ["long-candidate"], series: ["long-series"], facts: ["long-fact"], students: ["long-student"] });
  const payload = { nested: [{ id, [field]: [id, "truly-unknown-identifier"] }] };
  const encoded = codec.encode(payload) as typeof payload;
  expect(encoded.nested[0].id).toBe(alias);
  expect(encoded.nested[0][field]).toEqual([alias, "truly-unknown-identifier"]);
  expect(codec.decode(encoded)).toEqual(payload);
});

it("preserves raw keys, rationale, original words and unknown namespaces while aliasing identifier relations", () => {
  const codec = createModelIdentifierCodec({ candidates: ["long-candidate"], series: ["long-series"], facts: ["long-fact"], students: ["long-student"] });
  const payload = { recordId: "long-candidate", originalSeriesId: "long-series", sourceId: "long-fact", sourceIds: ["long-fact", "source-not-in-any-group"],
    key: "long-candidate", text: "long-fact", originalText: "long-student", rationale: "long-candidate", value: "@F0", label: "long-student",
    scope: "long-fact", conditions: ["long-fact", "@C0"], note: "long-candidate", allowedItems: ["long-candidate"] };
  const encoded = codec.encode(payload) as typeof payload;
  expect(encoded.recordId).toBe("@C0"); expect(encoded.originalSeriesId).toBe("@S0"); expect(encoded.sourceId).toBe("@F0");
  expect(encoded.sourceIds).toEqual(["@F0", "source-not-in-any-group"]);
  for (const field of ["key", "text", "originalText", "rationale", "value", "label", "scope", "conditions", "note", "allowedItems"] as const) expect(encoded[field]).toEqual(payload[field]);
  expect(codec.decode(encoded)).toEqual(payload);
});
