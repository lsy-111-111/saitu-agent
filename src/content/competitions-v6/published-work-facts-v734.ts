import type { CatalogFact, CatalogSource } from "../../lib/competitions/v6/catalog-types";
import { reviewedPublishedWorkBindingsV734 } from "./published-work-approvals-v734";

/** Explicit published-material observations only. Participant reports retain
 * the original other/body_read source and material scope. They are not contest
 * rules, independent outcome verification, or student resources/experience.
 * E's independently frozen full-binding strings determine approved content;
 * editing a candidate with the same ID cannot inherit that approval. */
export type PublishedWorkFactBindingV734 = {
  ownerId: string;
  ownerSeriesId: string;
  ownerCatalogVersion: string;
  fact: CatalogFact;
  sources: CatalogSource[];
  sourceProofs: { sourceId: string; artifactPath: string; sha256: string;
    bodyArtifactPath: string; bodySha256: string; locator: string;
    anchors: { page?: number; text: string }[] }[];
};

export const PUBLISHED_WORK_FACTS_VERSION_V734 = "saitu.published-work-facts.v7.34" as const;
export const candidatePublishedWorkFactsV734: readonly PublishedWorkFactBindingV734[] = [
  {
    "ownerId": "acm-student-research:2025-chi:hci-education-research:undergraduate:chi-2025-undergrad:v3",
    "ownerSeriesId": "acm-student-research",
    "ownerCatalogVersion": "saitu.catalog.v3.20261105.1",
    "fact": {
      "id": "acm-student-research:material:v734:research-structure",
      "field": "material.research_structure",
      "text": "作者公开论文分别叙述研究问题、问卷与后续访谈方法、研究结果、工具设计、试用反馈和未来工作。",
      "kind": "participant_report",
      "status": "historical",
      "sourceIds": [
        "chi-d1-chemlab-work"
      ],
      "scope": "作者公开的完整6页研究作品，DOI 10.1145/3706599.3719282",
      "sourceScopes": [
        {
          "sourceId": "chi-d1-chemlab-work",
          "scope": "作者公开的完整6页研究作品，DOI 10.1145/3706599.3719282"
        }
      ],
      "checkedAt": "2026-11-05",
      "supersedes": [],
      "conflictsWith": [],
      "entity": {
        "editionId": "2025-chi",
        "trackId": "hci-education-research",
        "groupId": "undergraduate",
        "scopeId": "chi-2025-undergrad"
      },
      "lastVerifiedAt": "2026-11-05"
    },
    "sources": [
      {
        "id": "chi-d1-chemlab-work",
        "url": "https://kimsieun.com/pdfs/chemlabplanner.pdf",
        "title": "Designing an Educational Tool to Improve Understanding and Planning in Chemistry Laboratory Courses",
        "publisher": "Sieun Kim／ACM CHI EA 2025",
        "scope": "作者公开的完整6页研究作品，DOI 10.1145/3706599.3719282",
        "locator": "第1—6页全文，表1及图1—8；第5页图7/8已渲染视觉核对",
        "publishedAt": "2025-04",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "accessStatus": "body_read",
        "authority": "other",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/learning-d1-reading-log.json",
        "publicationDate": {
          "raw": "2025-04",
          "value": "2025-04",
          "precision": "month",
          "timezone": null
        }
      }
    ],
    "sourceProofs": [
      {
        "sourceId": "chi-d1-chemlab-work",
        "artifactPath": "artifacts/v6/content-research/source-byte-snapshots/5ae130f922bb36480e7b2b66ea893466fa7a3b124cad9d894e08f993bb8e1e01.pdf",
        "sha256": "5ae130f922bb36480e7b2b66ea893466fa7a3b124cad9d894e08f993bb8e1e01",
        "bodyArtifactPath": "artifacts/v6/content-research/frozen-source-text/f69f36bb7215d501603ab3c11829828242c75eadab41af85ec0a7d6f6953b9ab.txt",
        "bodySha256": "f69f36bb7215d501603ab3c11829828242c75eadab41af85ec0a7d6f6953b9ab",
        "locator": "PDF第1—6页；研究问题、Methods、Results、工具设计、5.2 User Feedback及6.1 Future Work。",
        "anchors": [
          {
            "text": "research questions:",
            "page": 1
          },
          {
            "text": "3 Methods",
            "page": 2
          },
          {
            "text": "3.1 Survey",
            "page": 2
          },
          {
            "text": "3.2 Interview",
            "page": 2
          },
          {
            "text": "4 Results",
            "page": 2
          },
          {
            "text": "5.2 User Feedback",
            "page": 4
          },
          {
            "text": "6.1 Future Work",
            "page": 5
          }
        ]
      }
    ]
  },
  {
    "ownerId": "acm-student-research:2025-chi:hci-education-research:undergraduate:chi-2025-undergrad:v3",
    "ownerSeriesId": "acm-student-research",
    "ownerCatalogVersion": "saitu.catalog.v3.20261105.1",
    "fact": {
      "id": "acm-student-research:material:v734:nested-participant-groups",
      "field": "material.participant_groups",
      "text": "作者报告62名有化学实验课经历的本科生参加问卷，随后访谈其中5人，并让问卷参与者中的3人进行非正式试用；后两组均来自原问卷参与者。",
      "kind": "participant_report",
      "status": "historical",
      "sourceIds": [
        "chi-d1-chemlab-work"
      ],
      "scope": "作者公开的完整6页研究作品，DOI 10.1145/3706599.3719282",
      "sourceScopes": [
        {
          "sourceId": "chi-d1-chemlab-work",
          "scope": "作者公开的完整6页研究作品，DOI 10.1145/3706599.3719282"
        }
      ],
      "checkedAt": "2026-11-05",
      "supersedes": [],
      "conflictsWith": [],
      "entity": {
        "editionId": "2025-chi",
        "trackId": "hci-education-research",
        "groupId": "undergraduate",
        "scopeId": "chi-2025-undergrad"
      },
      "lastVerifiedAt": "2026-11-05"
    },
    "sources": [
      {
        "id": "chi-d1-chemlab-work",
        "url": "https://kimsieun.com/pdfs/chemlabplanner.pdf",
        "title": "Designing an Educational Tool to Improve Understanding and Planning in Chemistry Laboratory Courses",
        "publisher": "Sieun Kim／ACM CHI EA 2025",
        "scope": "作者公开的完整6页研究作品，DOI 10.1145/3706599.3719282",
        "locator": "第1—6页全文，表1及图1—8；第5页图7/8已渲染视觉核对",
        "publishedAt": "2025-04",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "accessStatus": "body_read",
        "authority": "other",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/learning-d1-reading-log.json",
        "publicationDate": {
          "raw": "2025-04",
          "value": "2025-04",
          "precision": "month",
          "timezone": null
        }
      }
    ],
    "sourceProofs": [
      {
        "sourceId": "chi-d1-chemlab-work",
        "artifactPath": "artifacts/v6/content-research/source-byte-snapshots/5ae130f922bb36480e7b2b66ea893466fa7a3b124cad9d894e08f993bb8e1e01.pdf",
        "sha256": "5ae130f922bb36480e7b2b66ea893466fa7a3b124cad9d894e08f993bb8e1e01",
        "bodyArtifactPath": "artifacts/v6/content-research/frozen-source-text/f69f36bb7215d501603ab3c11829828242c75eadab41af85ec0a7d6f6953b9ab.txt",
        "bodySha256": "f69f36bb7215d501603ab3c11829828242c75eadab41af85ec0a7d6f6953b9ab",
        "locator": "PDF第2页3.1/3.2、第4页5.2；保留问卷、追访与试用的从属关系，不相加为70名独立受试者。",
        "anchors": [
          {
            "text": "total of 62 undergraduate students with experience in these courses",
            "page": 2
          },
          {
            "text": "Follow-up interviews were conducted with five survey participants",
            "page": 2
          },
          {
            "text": "informal user tests were conducted with three sur-",
            "page": 4
          },
          {
            "text": "vey participants.",
            "page": 4
          }
        ]
      }
    ]
  },
  {
    "ownerId": "acm-student-research:2025-chi:hci-education-research:undergraduate:chi-2025-undergrad:v3",
    "ownerSeriesId": "acm-student-research",
    "ownerCatalogVersion": "saitu.catalog.v3.20261105.1",
    "fact": {
      "id": "acm-student-research:material:v734:evaluation-stage",
      "field": "material.evaluation_stage",
      "text": "论文5.2记录三名问卷参与者的非正式试用反馈，6.1把正式用户研究及比较实验规划与理解效果列为未来工作。",
      "kind": "participant_report",
      "status": "historical",
      "sourceIds": [
        "chi-d1-chemlab-work"
      ],
      "scope": "作者公开的完整6页研究作品，DOI 10.1145/3706599.3719282",
      "sourceScopes": [
        {
          "sourceId": "chi-d1-chemlab-work",
          "scope": "作者公开的完整6页研究作品，DOI 10.1145/3706599.3719282"
        }
      ],
      "checkedAt": "2026-11-05",
      "supersedes": [],
      "conflictsWith": [],
      "entity": {
        "editionId": "2025-chi",
        "trackId": "hci-education-research",
        "groupId": "undergraduate",
        "scopeId": "chi-2025-undergrad"
      },
      "lastVerifiedAt": "2026-11-05"
    },
    "sources": [
      {
        "id": "chi-d1-chemlab-work",
        "url": "https://kimsieun.com/pdfs/chemlabplanner.pdf",
        "title": "Designing an Educational Tool to Improve Understanding and Planning in Chemistry Laboratory Courses",
        "publisher": "Sieun Kim／ACM CHI EA 2025",
        "scope": "作者公开的完整6页研究作品，DOI 10.1145/3706599.3719282",
        "locator": "第1—6页全文，表1及图1—8；第5页图7/8已渲染视觉核对",
        "publishedAt": "2025-04",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "accessStatus": "body_read",
        "authority": "other",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/learning-d1-reading-log.json",
        "publicationDate": {
          "raw": "2025-04",
          "value": "2025-04",
          "precision": "month",
          "timezone": null
        }
      }
    ],
    "sourceProofs": [
      {
        "sourceId": "chi-d1-chemlab-work",
        "artifactPath": "artifacts/v6/content-research/source-byte-snapshots/5ae130f922bb36480e7b2b66ea893466fa7a3b124cad9d894e08f993bb8e1e01.pdf",
        "sha256": "5ae130f922bb36480e7b2b66ea893466fa7a3b124cad9d894e08f993bb8e1e01",
        "bodyArtifactPath": "artifacts/v6/content-research/frozen-source-text/f69f36bb7215d501603ab3c11829828242c75eadab41af85ec0a7d6f6953b9ab.txt",
        "bodySha256": "f69f36bb7215d501603ab3c11829828242c75eadab41af85ec0a7d6f6953b9ab",
        "locator": "PDF第4页5.2及第5页6.1；只陈述研究阶段，不把主观有用反馈升为已验证学习效果。",
        "anchors": [
          {
            "text": "5.2 User Feedback",
            "page": 4
          },
          {
            "text": "informal user tests were conducted with three sur-",
            "page": 4
          },
          {
            "text": "formal user",
            "page": 5
          },
          {
            "text": "studies can be conducted to evaluate ChemLab Planner",
            "page": 5
          }
        ]
      }
    ]
  },
  {
    "ownerId": "chemistry-experiment-innovation:2025-5:popular-science-cochineal:popular-science:china-2025-popular-science:v3",
    "ownerSeriesId": "chemistry-experiment-innovation",
    "ownerCatalogVersion": "saitu.catalog.v3.20261105.1",
    "fact": {
      "id": "chemistry-experiment-innovation:material:v734:blank-control",
      "field": "material.blank_control",
      "text": "作者论文1.4.3记录不加任何金属离子的空白对照组，并比较不同金属离子条件下的显色现象；这是原论文实验描述。",
      "kind": "participant_report",
      "status": "historical",
      "sourceIds": [
        "chem-cochineal-2026-work"
      ],
      "scope": "完整论文；第5届专题归属另由期刊网页支持，不构成官方命题或获奖证明",
      "sourceScopes": [
        {
          "sourceId": "chem-cochineal-2026-work",
          "scope": "完整论文；第5届专题归属另由期刊网页支持，不构成官方命题或获奖证明"
        }
      ],
      "checkedAt": "2026-11-05",
      "supersedes": [],
      "conflictsWith": [],
      "entity": {
        "editionId": "2025-5",
        "trackId": "popular-science-cochineal",
        "groupId": "popular-science",
        "scopeId": "china-2025-popular-science"
      },
      "lastVerifiedAt": "2026-11-05"
    },
    "sources": [
      {
        "id": "chem-cochineal-2026-work",
        "url": "https://www.dxhx.pku.edu.cn/CN/10.12461/PKU.DXHX202509113",
        "title": "从昆虫到可食用色素——解密胭脂虫红的色彩化学",
        "publisher": "杨子威等，《大学化学》",
        "scope": "完整论文；第5届专题归属另由期刊网页支持，不构成官方命题或获奖证明",
        "locator": "完整PDF120—130页，图5—9对照及第2节受众设计",
        "publishedAt": "2026-05-21",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "accessStatus": "body_read",
        "authority": "other",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/engineering-a-reading-log.json",
        "publicationDate": {
          "raw": "2026-05-21",
          "value": "2026-05-21",
          "precision": "day",
          "timezone": null
        }
      }
    ],
    "sourceProofs": [
      {
        "sourceId": "chem-cochineal-2026-work",
        "artifactPath": "artifacts/v6/content-research/source-byte-snapshots/b0a61a692f7bab380382064b9a1be50989dbd627748e58ea6441da1e1a7cc115.pdf",
        "sha256": "b0a61a692f7bab380382064b9a1be50989dbd627748e58ea6441da1e1a7cc115",
        "bodyArtifactPath": "artifacts/v6/content-research/frozen-source-text/f34af9ba428731bdf9a4161e5f290ed80d810e17f751304ab0c6dbd81c1050a1.txt",
        "bodySha256": "f34af9ba428731bdf9a4161e5f290ed80d810e17f751304ab0c6dbd81c1050a1",
        "locator": "PDF第5页（期刊124页）1.4.3及图6上下文；不提供学生可照做的实验配方。",
        "anchors": [
          {
            "text": "1.4.3  不同浓度的",
            "page": 5
          },
          {
            "text": "同时设置不加任何金属离子溶液作为空白对照组。",
            "page": 5
          }
        ]
      }
    ]
  },
  {
    "ownerId": "chemistry-experiment-innovation:2025-5:popular-science-cochineal:popular-science:china-2025-popular-science:v3",
    "ownerSeriesId": "chemistry-experiment-innovation",
    "ownerCatalogVersion": "saitu.catalog.v3.20261105.1",
    "fact": {
      "id": "chemistry-experiment-innovation:material:v734:measurement-modalities",
      "field": "material.measurement_modalities",
      "text": "作者论文展示酸碱和金属离子比色卡，并另列紫外可见吸收光谱研究，分别呈现颜色观察与光谱测量。",
      "kind": "participant_report",
      "status": "historical",
      "sourceIds": [
        "chem-cochineal-2026-work"
      ],
      "scope": "完整论文；第5届专题归属另由期刊网页支持，不构成官方命题或获奖证明",
      "sourceScopes": [
        {
          "sourceId": "chem-cochineal-2026-work",
          "scope": "完整论文；第5届专题归属另由期刊网页支持，不构成官方命题或获奖证明"
        }
      ],
      "checkedAt": "2026-11-05",
      "supersedes": [],
      "conflictsWith": [],
      "entity": {
        "editionId": "2025-5",
        "trackId": "popular-science-cochineal",
        "groupId": "popular-science",
        "scopeId": "china-2025-popular-science"
      },
      "lastVerifiedAt": "2026-11-05"
    },
    "sources": [
      {
        "id": "chem-cochineal-2026-work",
        "url": "https://www.dxhx.pku.edu.cn/CN/10.12461/PKU.DXHX202509113",
        "title": "从昆虫到可食用色素——解密胭脂虫红的色彩化学",
        "publisher": "杨子威等，《大学化学》",
        "scope": "完整论文；第5届专题归属另由期刊网页支持，不构成官方命题或获奖证明",
        "locator": "完整PDF120—130页，图5—9对照及第2节受众设计",
        "publishedAt": "2026-05-21",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "accessStatus": "body_read",
        "authority": "other",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/engineering-a-reading-log.json",
        "publicationDate": {
          "raw": "2026-05-21",
          "value": "2026-05-21",
          "precision": "day",
          "timezone": null
        }
      }
    ],
    "sourceProofs": [
      {
        "sourceId": "chem-cochineal-2026-work",
        "artifactPath": "artifacts/v6/content-research/source-byte-snapshots/b0a61a692f7bab380382064b9a1be50989dbd627748e58ea6441da1e1a7cc115.pdf",
        "sha256": "b0a61a692f7bab380382064b9a1be50989dbd627748e58ea6441da1e1a7cc115",
        "bodyArtifactPath": "artifacts/v6/content-research/frozen-source-text/f34af9ba428731bdf9a4161e5f290ed80d810e17f751304ab0c6dbd81c1050a1.txt",
        "bodySha256": "f34af9ba428731bdf9a4161e5f290ed80d810e17f751304ab0c6dbd81c1050a1",
        "locator": "PDF第5—7页（期刊124—126页）图5、图6、1.4.6及图9；保留观察方式的区别和用途边界。",
        "anchors": [
          {
            "text": "酸碱比色卡及 RGB值",
            "page": 5
          },
          {
            "text": "金属比色卡的构建",
            "page": 5
          },
          {
            "text": "1.4.6  不同颜色胭脂虫红溶液的紫外可见光谱研究",
            "page": 6
          },
          {
            "text": "图9",
            "page": 7
          }
        ]
      }
    ]
  },
  {
    "ownerId": "chemistry-experiment-innovation:2025-5:popular-science-cochineal:popular-science:china-2025-popular-science:v3",
    "ownerSeriesId": "chemistry-experiment-innovation",
    "ownerCatalogVersion": "saitu.catalog.v3.20261105.1",
    "fact": {
      "id": "chemistry-experiment-innovation:material:v734:audience-design",
      "field": "material.audience_design",
      "text": "作者论文第2节按线上、学前儿童与小学生、中学生、非化学相关专业大学生及大众群体，分别组织科普展示和互动方案。",
      "kind": "participant_report",
      "status": "historical",
      "sourceIds": [
        "chem-cochineal-2026-work"
      ],
      "scope": "完整论文；第5届专题归属另由期刊网页支持，不构成官方命题或获奖证明",
      "sourceScopes": [
        {
          "sourceId": "chem-cochineal-2026-work",
          "scope": "完整论文；第5届专题归属另由期刊网页支持，不构成官方命题或获奖证明"
        }
      ],
      "checkedAt": "2026-11-05",
      "supersedes": [],
      "conflictsWith": [],
      "entity": {
        "editionId": "2025-5",
        "trackId": "popular-science-cochineal",
        "groupId": "popular-science",
        "scopeId": "china-2025-popular-science"
      },
      "lastVerifiedAt": "2026-11-05"
    },
    "sources": [
      {
        "id": "chem-cochineal-2026-work",
        "url": "https://www.dxhx.pku.edu.cn/CN/10.12461/PKU.DXHX202509113",
        "title": "从昆虫到可食用色素——解密胭脂虫红的色彩化学",
        "publisher": "杨子威等，《大学化学》",
        "scope": "完整论文；第5届专题归属另由期刊网页支持，不构成官方命题或获奖证明",
        "locator": "完整PDF120—130页，图5—9对照及第2节受众设计",
        "publishedAt": "2026-05-21",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "accessStatus": "body_read",
        "authority": "other",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/engineering-a-reading-log.json",
        "publicationDate": {
          "raw": "2026-05-21",
          "value": "2026-05-21",
          "precision": "day",
          "timezone": null
        }
      }
    ],
    "sourceProofs": [
      {
        "sourceId": "chem-cochineal-2026-work",
        "artifactPath": "artifacts/v6/content-research/source-byte-snapshots/b0a61a692f7bab380382064b9a1be50989dbd627748e58ea6441da1e1a7cc115.pdf",
        "sha256": "b0a61a692f7bab380382064b9a1be50989dbd627748e58ea6441da1e1a7cc115",
        "bodyArtifactPath": "artifacts/v6/content-research/frozen-source-text/f34af9ba428731bdf9a4161e5f290ed80d810e17f751304ab0c6dbd81c1050a1.txt",
        "bodySha256": "f34af9ba428731bdf9a4161e5f290ed80d810e17f751304ab0c6dbd81c1050a1",
        "locator": "PDF第7—10页（期刊126—129页）第2节及2.1—2.5；只记载受众与方案结构，不补理解题或学习效果证据。",
        "anchors": [
          {
            "text": "2  科普展示和互动方案",
            "page": 7
          },
          {
            "text": "2.1  线上科普方案",
            "page": 8
          },
          {
            "text": "2.2  面向学前儿童和小学生的科普方案",
            "page": 8
          },
          {
            "text": "2.3  面向中学生的科普方案",
            "page": 9
          },
          {
            "text": "2.4  面向非化学相关专业的大学生的科普方案",
            "page": 9
          },
          {
            "text": "2.5  面向大众群体的科普方案",
            "page": 10
          }
        ]
      }
    ]
  },
  {
    "ownerId": "ncyu-special-education-demonstration:2016-2017-105:reading-lesson-design:pre-service-teachers:taiwan-105-special-education:v3",
    "ownerSeriesId": "ncyu-special-education-demonstration",
    "ownerCatalogVersion": "saitu.catalog.v3.20261105.1",
    "fact": {
      "id": "ncyu-special-education-demonstration:material:v734:lesson-design-structure",
      "field": "material.lesson_design_structure",
      "text": "公开教案《漫游古都》的第三节方案列出教学准备、单元和具体学习目标、活动流程及教学评量。",
      "kind": "participant_report",
      "status": "historical",
      "sourceIds": [
        "teach-d2-roaming-lesson"
      ],
      "scope": "105学年度公开教案；只分析教学设计，不作儿童诊断或一般疗效判断",
      "sourceScopes": [
        {
          "sourceId": "teach-d2-roaming-lesson",
          "scope": "105学年度公开教案；只分析教学设计，不作儿童诊断或一般疗效判断"
        }
      ],
      "checkedAt": "2026-11-05",
      "supersedes": [],
      "conflictsWith": [],
      "entity": {
        "editionId": "2016-2017-105",
        "trackId": "reading-lesson-design",
        "groupId": "pre-service-teachers",
        "scopeId": "taiwan-105-special-education"
      },
      "lastVerifiedAt": "2026-11-05"
    },
    "sources": [
      {
        "id": "teach-d2-roaming-lesson",
        "url": "https://www.ncyu.edu.tw/cset/ServerFile/Get/76a7da0c-2c2c-4706-8577-4a828b139328?nodeId=50587&sId=102478",
        "title": "漫游古都完整教学活动设计",
        "publisher": "匿名参赛作者；嘉义大学公开归档",
        "scope": "105学年度公开教案；只分析教学设计，不作儿童诊断或一般疗效判断",
        "locator": "PDF全21页文字；第16页活动表视觉核对，第三节40分钟完整方案与第20页反思",
        "publishedAt": null,
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "accessStatus": "body_read",
        "authority": "other",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/learning-d2-reading-log.json",
        "publicationDate": {
          "raw": null,
          "value": null,
          "precision": "unknown",
          "timezone": null
        }
      }
    ],
    "sourceProofs": [
      {
        "sourceId": "teach-d2-roaming-lesson",
        "artifactPath": "artifacts/v6/content-research/source-byte-snapshots/253dfa9d414a7bf6aec1c1c26fe1b6dde36a8311cc184574fa53f43c8e581dfe.pdf",
        "sha256": "253dfa9d414a7bf6aec1c1c26fe1b6dde36a8311cc184574fa53f43c8e581dfe",
        "bodyArtifactPath": "artifacts/v6/content-research/frozen-source-text/d49f02057eb54babebeda3f9d430669968bb2ed5dc774e42dfa959ccafbb3b2d.txt",
        "bodySha256": "d49f02057eb54babebeda3f9d430669968bb2ed5dc774e42dfa959ccafbb3b2d",
        "locator": "PDF第14—17页；第三节完整教学设计；只摘教学方案，不转述儿童个体测评资料。",
        "anchors": [
          {
            "text": "教學準備",
            "page": 14
          },
          {
            "text": "學習目標",
            "page": 15
          },
          {
            "text": "單元目標 具體目標",
            "page": 15
          },
          {
            "text": "肆、教學評量",
            "page": 17
          }
        ]
      }
    ]
  },
  {
    "ownerId": "ncyu-special-education-demonstration:2016-2017-105:reading-lesson-design:pre-service-teachers:taiwan-105-special-education:v3",
    "ownerSeriesId": "ncyu-special-education-demonstration",
    "ownerCatalogVersion": "saitu.catalog.v3.20261105.1",
    "fact": {
      "id": "ncyu-special-education-demonstration:material:v734:prompted-goal-and-assessment",
      "field": "material.prompted_goal",
      "text": "教案第15页的目标包含在教师提示下说出文章基本架构，第15—17页还列出教师示范、学生作答以及口头、实作和纸笔评量。",
      "kind": "participant_report",
      "status": "historical",
      "sourceIds": [
        "teach-d2-roaming-lesson"
      ],
      "scope": "105学年度公开教案；只分析教学设计，不作儿童诊断或一般疗效判断",
      "sourceScopes": [
        {
          "sourceId": "teach-d2-roaming-lesson",
          "scope": "105学年度公开教案；只分析教学设计，不作儿童诊断或一般疗效判断"
        }
      ],
      "checkedAt": "2026-11-05",
      "supersedes": [],
      "conflictsWith": [],
      "entity": {
        "editionId": "2016-2017-105",
        "trackId": "reading-lesson-design",
        "groupId": "pre-service-teachers",
        "scopeId": "taiwan-105-special-education"
      },
      "lastVerifiedAt": "2026-11-05"
    },
    "sources": [
      {
        "id": "teach-d2-roaming-lesson",
        "url": "https://www.ncyu.edu.tw/cset/ServerFile/Get/76a7da0c-2c2c-4706-8577-4a828b139328?nodeId=50587&sId=102478",
        "title": "漫游古都完整教学活动设计",
        "publisher": "匿名参赛作者；嘉义大学公开归档",
        "scope": "105学年度公开教案；只分析教学设计，不作儿童诊断或一般疗效判断",
        "locator": "PDF全21页文字；第16页活动表视觉核对，第三节40分钟完整方案与第20页反思",
        "publishedAt": null,
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "accessStatus": "body_read",
        "authority": "other",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/learning-d2-reading-log.json",
        "publicationDate": {
          "raw": null,
          "value": null,
          "precision": "unknown",
          "timezone": null
        }
      }
    ],
    "sourceProofs": [
      {
        "sourceId": "teach-d2-roaming-lesson",
        "artifactPath": "artifacts/v6/content-research/source-byte-snapshots/253dfa9d414a7bf6aec1c1c26fe1b6dde36a8311cc184574fa53f43c8e581dfe.pdf",
        "sha256": "253dfa9d414a7bf6aec1c1c26fe1b6dde36a8311cc184574fa53f43c8e581dfe",
        "bodyArtifactPath": "artifacts/v6/content-research/frozen-source-text/d49f02057eb54babebeda3f9d430669968bb2ed5dc774e42dfa959ccafbb3b2d.txt",
        "bodySha256": "d49f02057eb54babebeda3f9d430669968bb2ed5dc774e42dfa959ccafbb3b2d",
        "locator": "PDF第15页1-3/2-1、第16页活动表及第17页评量；保留提示条件与设计阶段。",
        "anchors": [
          {
            "text": "1-3 在教師提示下，能正確說出文章",
            "page": 15
          },
          {
            "text": "2-1 教師教導示範後",
            "page": 15
          },
          {
            "text": "書空練習筆順，並完成學習單",
            "page": 16
          },
          {
            "text": "口頭評量",
            "page": 17
          },
          {
            "text": "實作評量",
            "page": 17
          }
        ]
      }
    ]
  },
  {
    "ownerId": "taiwan-child-rights-lesson-contest:2023-first:preschool-rights-learning:preschool-student:taiwan-2023-preschool-student:v3",
    "ownerSeriesId": "taiwan-child-rights-lesson-contest",
    "ownerCatalogVersion": "saitu.catalog.v3.20261105.1",
    "fact": {
      "id": "taiwan-child-rights-lesson-contest:material:v734:activity-and-record",
      "field": "material.activity_and_record",
      "text": "公开教案《儿童权利你我他》第三课安排情境讨论与桌游活动，并让儿童绘画、口述选择情境的原因，由家长或老师协助文字记录。",
      "kind": "participant_report",
      "status": "historical",
      "sourceIds": [
        "teach-d3-children-rights-work"
      ],
      "scope": "2023公开参赛作品，作为教学设计评读而非权利解释的权威教材",
      "sourceScopes": [
        {
          "sourceId": "teach-d3-children-rights-work",
          "scope": "2023公开参赛作品，作为教学设计评读而非权利解释的权威教材"
        }
      ],
      "checkedAt": "2026-11-05",
      "supersedes": [],
      "conflictsWith": [],
      "entity": {
        "editionId": "2023-first",
        "trackId": "preschool-rights-learning",
        "groupId": "preschool-student",
        "scopeId": "taiwan-2023-preschool-student"
      },
      "lastVerifiedAt": "2026-11-05"
    },
    "sources": [
      {
        "id": "teach-d3-children-rights-work",
        "url": "https://tgeea.org.tw/wp-content/uploads/2023/10/%E5%B9%BC%E6%95%99%E5%B8%AB%E8%B3%87%E7%94%9F%E7%B5%84_%E5%82%91%E5%87%BA%E7%8D%8E_%E5%85%92%E7%AB%A5%E6%AC%8A%E5%88%A9%E4%BD%A0%E6%88%91%E4%BB%96_2023%E5%B9%B4%E7%AC%AC%E4%B8%80%E5%B1%86%E8%87%BA%E7%81%A3%E5%A9%A6%E5%A5%B3%E3%80%81%E5%85%92%E7%AB%A5%E4%BA%BA%E6%AC%8A%E6%95%99%E6%A1%88%E8%A8%AD%E8%A8%88%E7%AB%B6%E8%B3%BD.pdf",
        "title": "儿童权利你我他：2023幼教师资生组杰出奖完整教案",
        "publisher": "张茹恩、郭又慈、张佩怡、黄慧欣；协办方台湾性别平等教育协会公开",
        "scope": "2023公开参赛作品，作为教学设计评读而非权利解释的权威教材",
        "locator": "17页全部文字；第2页主题网及第13—17页全部图像附件视觉核对；重点第8—9页第三课和第15—16页评价材料",
        "publishedAt": null,
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "accessStatus": "body_read",
        "authority": "other",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/learning-d3-reading-log.json",
        "publicationDate": {
          "raw": null,
          "value": null,
          "precision": "unknown",
          "timezone": null
        }
      }
    ],
    "sourceProofs": [
      {
        "sourceId": "teach-d3-children-rights-work",
        "artifactPath": "artifacts/v6/content-research/source-byte-snapshots/1fcf305bb4ad82477e8a755d2eef96ae1ac4077792dba14ac5674bbb6e5f2176.pdf",
        "sha256": "1fcf305bb4ad82477e8a755d2eef96ae1ac4077792dba14ac5674bbb6e5f2176",
        "bodyArtifactPath": "artifacts/v6/content-research/frozen-source-text/7c957927669ae5fc9dbf0c26daf9c2d6c7c9956868d5dfdc242f1b03351a594c.txt",
        "bodySha256": "7c957927669ae5fc9dbf0c26daf9c2d6c7c9956868d5dfdc242f1b03351a594c",
        "locator": "PDF第8—9页第三课及第15—16页卡片/记录单；书包情境在第9页正文，不能冒称第15页卡片原文。",
        "anchors": [
          {
            "text": "活動二：",
            "page": 8
          },
          {
            "text": "小名看到了小華的書包",
            "page": 9
          },
          {
            "text": "學習單，讓小朋友繪畫在遊戲中印象最深刻的卡片",
            "page": 9
          },
          {
            "text": "何選擇此情境的原因，並由家長或老師幫忙使用文字紀錄。",
            "page": 9
          }
        ]
      }
    ]
  },
  {
    "ownerId": "taiwan-child-rights-lesson-contest:2023-first:preschool-rights-learning:preschool-student:taiwan-2023-preschool-student:v3",
    "ownerSeriesId": "taiwan-child-rights-lesson-contest",
    "ownerCatalogVersion": "saitu.catalog.v3.20261105.1",
    "fact": {
      "id": "taiwan-child-rights-lesson-contest:material:v734:question-four-options",
      "field": "material.question_four_options",
      "text": "原教案第13页情境四询问举手发言表达意见的机会属于何种权利，同题列出的四个选项是教育权、健康权、生存权和游戏权。",
      "kind": "participant_report",
      "status": "historical",
      "sourceIds": [
        "teach-d3-children-rights-work"
      ],
      "scope": "2023公开参赛作品，作为教学设计评读而非权利解释的权威教材",
      "sourceScopes": [
        {
          "sourceId": "teach-d3-children-rights-work",
          "scope": "2023公开参赛作品，作为教学设计评读而非权利解释的权威教材"
        }
      ],
      "checkedAt": "2026-11-05",
      "supersedes": [],
      "conflictsWith": [],
      "entity": {
        "editionId": "2023-first",
        "trackId": "preschool-rights-learning",
        "groupId": "preschool-student",
        "scopeId": "taiwan-2023-preschool-student"
      },
      "lastVerifiedAt": "2026-11-05"
    },
    "sources": [
      {
        "id": "teach-d3-children-rights-work",
        "url": "https://tgeea.org.tw/wp-content/uploads/2023/10/%E5%B9%BC%E6%95%99%E5%B8%AB%E8%B3%87%E7%94%9F%E7%B5%84_%E5%82%91%E5%87%BA%E7%8D%8E_%E5%85%92%E7%AB%A5%E6%AC%8A%E5%88%A9%E4%BD%A0%E6%88%91%E4%BB%96_2023%E5%B9%B4%E7%AC%AC%E4%B8%80%E5%B1%86%E8%87%BA%E7%81%A3%E5%A9%A6%E5%A5%B3%E3%80%81%E5%85%92%E7%AB%A5%E4%BA%BA%E6%AC%8A%E6%95%99%E6%A1%88%E8%A8%AD%E8%A8%88%E7%AB%B6%E8%B3%BD.pdf",
        "title": "儿童权利你我他：2023幼教师资生组杰出奖完整教案",
        "publisher": "张茹恩、郭又慈、张佩怡、黄慧欣；协办方台湾性别平等教育协会公开",
        "scope": "2023公开参赛作品，作为教学设计评读而非权利解释的权威教材",
        "locator": "17页全部文字；第2页主题网及第13—17页全部图像附件视觉核对；重点第8—9页第三课和第15—16页评价材料",
        "publishedAt": null,
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "accessStatus": "body_read",
        "authority": "other",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/learning-d3-reading-log.json",
        "publicationDate": {
          "raw": null,
          "value": null,
          "precision": "unknown",
          "timezone": null
        }
      }
    ],
    "sourceProofs": [
      {
        "sourceId": "teach-d3-children-rights-work",
        "artifactPath": "artifacts/v6/content-research/source-byte-snapshots/1fcf305bb4ad82477e8a755d2eef96ae1ac4077792dba14ac5674bbb6e5f2176.pdf",
        "sha256": "1fcf305bb4ad82477e8a755d2eef96ae1ac4077792dba14ac5674bbb6e5f2176",
        "bodyArtifactPath": "artifacts/v6/content-research/frozen-source-text/7c957927669ae5fc9dbf0c26daf9c2d6c7c9956868d5dfdc242f1b03351a594c.txt",
        "bodySha256": "7c957927669ae5fc9dbf0c26daf9c2d6c7c9956868d5dfdc242f1b03351a594c",
        "locator": "PDF第13页附件一题组二情境四；已渲染目视核对题干和四个图文选项。选项是否匹配另作有据编辑分析，不标为官方权利解释。",
        "anchors": [
          {
            "text": "情境四 : 我們有舉手發言表達意見的機會",
            "page": 13
          },
          {
            "text": "教育權   健康權    生存權 遊戲權",
            "page": 13
          }
        ]
      }
    ]
  },
  {
    "ownerId": "biomod:2023:biomolecular-design:undergraduate:biomod-2023:v3",
    "ownerSeriesId": "biomod",
    "ownerCatalogVersion": "saitu.catalog.v3.20261105.1",
    "fact": {
      "id": "biomod:material:v734:design-and-simulation",
      "field": "material.design_simulation",
      "text": "Team Sendai 2023作者Design页说明以caDNAno设计DNA结构，并用CanDo与oxDNA核查或模拟结构稳定性和运动。",
      "kind": "participant_report",
      "status": "historical",
      "sourceIds": [
        "biomod-2023-sendai-design"
      ],
      "scope": "作者公开的结构设计与模拟",
      "sourceScopes": [
        {
          "sourceId": "biomod-2023-sendai-design",
          "scope": "作者公开的结构设计与模拟"
        }
      ],
      "checkedAt": "2026-11-05",
      "supersedes": [],
      "conflictsWith": [],
      "entity": {
        "editionId": "2023",
        "trackId": "biomolecular-design",
        "groupId": "undergraduate",
        "scopeId": "biomod-2023"
      },
      "lastVerifiedAt": "2026-11-05"
    },
    "sources": [
      {
        "id": "biomod-2023-sendai-design",
        "url": "https://teamsendai2023.github.io/design.html",
        "title": "Team Sendai 2023 NanoStoma：Design",
        "publisher": "Team Sendai 2023",
        "scope": "作者公开的结构设计与模拟",
        "locator": "Overview、Main structure、Self-stacking、Slit",
        "publishedAt": "2023",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "accessStatus": "body_read",
        "authority": "other",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/continuation-20261105/content/source-rechecks-batch06/reading-log.json",
        "publicationDate": {
          "raw": "2023",
          "value": "2023",
          "precision": "year",
          "timezone": null
        }
      }
    ],
    "sourceProofs": [
      {
        "sourceId": "biomod-2023-sendai-design",
        "artifactPath": "artifacts/v6/content-research/source-byte-snapshots/00d26ae56451866a1092a0c1250cab51690e90985722731d8a7fd5f0f094218f.html",
        "sha256": "00d26ae56451866a1092a0c1250cab51690e90985722731d8a7fd5f0f094218f",
        "bodyArtifactPath": "artifacts/v6/content-research/frozen-source-text/1578acd7969a9640f09139db9ffbba0227a6735042c7f604e4d3cb8da63b2629.txt",
        "bodySha256": "1578acd7969a9640f09139db9ffbba0227a6735042c7f604e4d3cb8da63b2629",
        "locator": "Design页THE MAIN STRUCTURE；caDNAno、CanDo及oxDNA段落；保留模拟与实测之别。",
        "anchors": [
          {
            "text": "The main structure was designed using caDNAno."
          },
          {
            "text": "After designing, we checked the stability of our structure"
          },
          {
            "text": "CanDo."
          },
          {
            "text": "oxDNA"
          }
        ]
      }
    ]
  },
  {
    "ownerId": "biomod:2023:biomolecular-design:undergraduate:biomod-2023:v3",
    "ownerSeriesId": "biomod",
    "ownerCatalogVersion": "saitu.catalog.v3.20261105.1",
    "fact": {
      "id": "biomod:material:v734:substitute-lock-test",
      "field": "material.substitute_lock_test",
      "text": "作者Experiment页说明先用toehold-mediated strand displacement（TMSD）替代偶氮苯系统测试开关机制。",
      "kind": "participant_report",
      "status": "historical",
      "sourceIds": [
        "biomod-2023-sendai-experiment"
      ],
      "scope": "作者公开的组件实验、失败与修改，不等于完整气体阀已验证",
      "sourceScopes": [
        {
          "sourceId": "biomod-2023-sendai-experiment",
          "scope": "作者公开的组件实验、失败与修改，不等于完整气体阀已验证"
        }
      ],
      "checkedAt": "2026-11-05",
      "supersedes": [],
      "conflictsWith": [],
      "entity": {
        "editionId": "2023",
        "trackId": "biomolecular-design",
        "groupId": "undergraduate",
        "scopeId": "biomod-2023"
      },
      "lastVerifiedAt": "2026-11-05"
    },
    "sources": [
      {
        "id": "biomod-2023-sendai-experiment",
        "url": "https://teamsendai2023.github.io/experiment.html",
        "title": "Team Sendai 2023 NanoStoma：Experiment",
        "publisher": "Team Sendai 2023",
        "scope": "作者公开的组件实验、失败与修改，不等于完整气体阀已验证",
        "locator": "Summary及各实验Results and Discussion，尤其Locking mechanism",
        "publishedAt": "2023",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "accessStatus": "body_read",
        "authority": "other",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/continuation-20261105/content/source-rechecks-batch06/reading-log.json",
        "publicationDate": {
          "raw": "2023",
          "value": "2023",
          "precision": "year",
          "timezone": null
        }
      }
    ],
    "sourceProofs": [
      {
        "sourceId": "biomod-2023-sendai-experiment",
        "artifactPath": "artifacts/v6/content-research/source-byte-snapshots/efd7a2bb781ad1e3dbc514807cd1ad69c5159e7bb35d9eb3bdd41eae8e954495.html",
        "sha256": "efd7a2bb781ad1e3dbc514807cd1ad69c5159e7bb35d9eb3bdd41eae8e954495",
        "bodyArtifactPath": "artifacts/v6/content-research/frozen-source-text/133740676c07858dadee220090d2c77b7d06364812efc29eb924db8d4412ae8d.txt",
        "bodySha256": "133740676c07858dadee220090d2c77b7d06364812efc29eb924db8d4412ae8d",
        "locator": "Experiment页SUMMARY及LOCKING MECHANISM Background/Results；原作者明确先测替代TMSD组件，光控仍是拟复制阶段。",
        "anchors": [
          {
            "text": "displacement first instead of the azobenzene-based system"
          },
          {
            "text": "toehold-mediated strand displacement (TMSD) reaction"
          },
          {
            "text": "ready to be replicated in an azobenzene-controlled fashion."
          }
        ]
      }
    ]
  },
  {
    "ownerId": "biomod:2023:biomolecular-design:undergraduate:biomod-2023:v3",
    "ownerSeriesId": "biomod",
    "ownerCatalogVersion": "saitu.catalog.v3.20261105.1",
    "fact": {
      "id": "biomod:material:v734:gel-body-sixteen",
      "field": "material.gel_body_description",
      "text": "作者实验页LOCKING MECHANISM的方法正文把PAGE所用胶记为16% acrylamide gel。",
      "kind": "participant_report",
      "status": "historical",
      "sourceIds": [
        "biomod-2023-sendai-experiment"
      ],
      "scope": "作者公开的组件实验、失败与修改，不等于完整气体阀已验证",
      "sourceScopes": [
        {
          "sourceId": "biomod-2023-sendai-experiment",
          "scope": "作者公开的组件实验、失败与修改，不等于完整气体阀已验证"
        }
      ],
      "checkedAt": "2026-11-05",
      "supersedes": [],
      "conflictsWith": [],
      "entity": {
        "editionId": "2023",
        "trackId": "biomolecular-design",
        "groupId": "undergraduate",
        "scopeId": "biomod-2023"
      },
      "lastVerifiedAt": "2026-11-05"
    },
    "sources": [
      {
        "id": "biomod-2023-sendai-experiment",
        "url": "https://teamsendai2023.github.io/experiment.html",
        "title": "Team Sendai 2023 NanoStoma：Experiment",
        "publisher": "Team Sendai 2023",
        "scope": "作者公开的组件实验、失败与修改，不等于完整气体阀已验证",
        "locator": "Summary及各实验Results and Discussion，尤其Locking mechanism",
        "publishedAt": "2023",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "accessStatus": "body_read",
        "authority": "other",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/continuation-20261105/content/source-rechecks-batch06/reading-log.json",
        "publicationDate": {
          "raw": "2023",
          "value": "2023",
          "precision": "year",
          "timezone": null
        }
      }
    ],
    "sourceProofs": [
      {
        "sourceId": "biomod-2023-sendai-experiment",
        "artifactPath": "artifacts/v6/content-research/source-byte-snapshots/efd7a2bb781ad1e3dbc514807cd1ad69c5159e7bb35d9eb3bdd41eae8e954495.html",
        "sha256": "efd7a2bb781ad1e3dbc514807cd1ad69c5159e7bb35d9eb3bdd41eae8e954495",
        "bodyArtifactPath": "artifacts/v6/content-research/frozen-source-text/133740676c07858dadee220090d2c77b7d06364812efc29eb924db8d4412ae8d.txt",
        "bodySha256": "133740676c07858dadee220090d2c77b7d06364812efc29eb924db8d4412ae8d",
        "locator": "Experiment页LOCKING MECHANISM方法正文；这里只记录作者正文16%，不认定其是正确或可复现实验参数。",
        "anchors": [
          {
            "text": "using 16% acrylamide gel"
          }
        ]
      }
    ]
  },
  {
    "ownerId": "biomod:2023:biomolecular-design:undergraduate:biomod-2023:v3",
    "ownerSeriesId": "biomod",
    "ownerCatalogVersion": "saitu.catalog.v3.20261105.1",
    "fact": {
      "id": "biomod:material:v734:gel-table-twenty",
      "field": "material.gel_table_caption",
      "text": "同一作者实验页Table 7的原始图像标题写作Gel recipe (20%)。",
      "kind": "participant_report",
      "status": "historical",
      "sourceIds": [
        "biomod-2023-sendai-experiment"
      ],
      "scope": "作者公开的组件实验、失败与修改，不等于完整气体阀已验证",
      "sourceScopes": [
        {
          "sourceId": "biomod-2023-sendai-experiment",
          "scope": "作者公开的组件实验、失败与修改，不等于完整气体阀已验证"
        }
      ],
      "checkedAt": "2026-11-05",
      "supersedes": [],
      "conflictsWith": [],
      "entity": {
        "editionId": "2023",
        "trackId": "biomolecular-design",
        "groupId": "undergraduate",
        "scopeId": "biomod-2023"
      },
      "lastVerifiedAt": "2026-11-05"
    },
    "sources": [
      {
        "id": "biomod-2023-sendai-experiment",
        "url": "https://teamsendai2023.github.io/experiment.html",
        "title": "Team Sendai 2023 NanoStoma：Experiment",
        "publisher": "Team Sendai 2023",
        "scope": "作者公开的组件实验、失败与修改，不等于完整气体阀已验证",
        "locator": "Summary及各实验Results and Discussion，尤其Locking mechanism",
        "publishedAt": "2023",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "accessStatus": "body_read",
        "authority": "other",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/continuation-20261105/content/source-rechecks-batch06/reading-log.json",
        "publicationDate": {
          "raw": "2023",
          "value": "2023",
          "precision": "year",
          "timezone": null
        }
      }
    ],
    "sourceProofs": [
      {
        "sourceId": "biomod-2023-sendai-experiment",
        "artifactPath": "artifacts/v6/content-research/source-byte-snapshots/efd7a2bb781ad1e3dbc514807cd1ad69c5159e7bb35d9eb3bdd41eae8e954495.html",
        "sha256": "efd7a2bb781ad1e3dbc514807cd1ad69c5159e7bb35d9eb3bdd41eae8e954495",
        "bodyArtifactPath": "artifacts/v6/content-research/frozen-source-text/133740676c07858dadee220090d2c77b7d06364812efc29eb924db8d4412ae8d.txt",
        "bodySha256": "133740676c07858dadee220090d2c77b7d06364812efc29eb924db8d4412ae8d",
        "locator": "Experiment页Table 7原始PNG，已目视核对20%标题；与正文16%的差异另作比较推断，不将任一数值当可复现实验参数。",
        "anchors": [
          {
            "text": "Table 7. Polyacrylamide gel recipe"
          }
        ]
      },
      {
        "sourceId": "biomod-2023-sendai-experiment",
        "artifactPath": "artifacts/continuation-20261105/content/source-rechecks-batch04/biomod-assets/experiment-12.png",
        "sha256": "e150a7ec576c71525d37ab6a4eca24b259c599535d728cc0b99dcf13cfca8931",
        "bodyArtifactPath": "artifacts/continuation-20261105/content/source-rechecks-batch04/biomod-assets/experiment-12.png",
        "bodySha256": "e150a7ec576c71525d37ab6a4eca24b259c599535d728cc0b99dcf13cfca8931",
        "locator": "同页Table 7原始PNG；B已实际view_image读取标题Gel recipe (20%)，不是网页正文16%。",
        "anchors": [
          {
            "text": "Gel recipe (20%)"
          }
        ]
      }
    ]
  },
  {
    "ownerId": "biomod:2023:biomolecular-design:undergraduate:biomod-2023:v3",
    "ownerSeriesId": "biomod",
    "ownerCatalogVersion": "saitu.catalog.v3.20261105.1",
    "fact": {
      "id": "biomod:material:v734:reported-failure-and-redesign",
      "field": "material.failure_and_redesign",
      "text": "作者报告原设计第2链30nt时未出现预期四链组合条带，改为34nt后将新条带解释为TMSD锁开关，并称随后可在偶氮苯控制方式中复制。",
      "kind": "participant_report",
      "status": "historical",
      "sourceIds": [
        "biomod-2023-sendai-experiment"
      ],
      "scope": "作者公开的组件实验、失败与修改，不等于完整气体阀已验证",
      "sourceScopes": [
        {
          "sourceId": "biomod-2023-sendai-experiment",
          "scope": "作者公开的组件实验、失败与修改，不等于完整气体阀已验证"
        }
      ],
      "checkedAt": "2026-11-05",
      "supersedes": [],
      "conflictsWith": [],
      "entity": {
        "editionId": "2023",
        "trackId": "biomolecular-design",
        "groupId": "undergraduate",
        "scopeId": "biomod-2023"
      },
      "lastVerifiedAt": "2026-11-05"
    },
    "sources": [
      {
        "id": "biomod-2023-sendai-experiment",
        "url": "https://teamsendai2023.github.io/experiment.html",
        "title": "Team Sendai 2023 NanoStoma：Experiment",
        "publisher": "Team Sendai 2023",
        "scope": "作者公开的组件实验、失败与修改，不等于完整气体阀已验证",
        "locator": "Summary及各实验Results and Discussion，尤其Locking mechanism",
        "publishedAt": "2023",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "accessStatus": "body_read",
        "authority": "other",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/continuation-20261105/content/source-rechecks-batch06/reading-log.json",
        "publicationDate": {
          "raw": "2023",
          "value": "2023",
          "precision": "year",
          "timezone": null
        }
      }
    ],
    "sourceProofs": [
      {
        "sourceId": "biomod-2023-sendai-experiment",
        "artifactPath": "artifacts/v6/content-research/source-byte-snapshots/efd7a2bb781ad1e3dbc514807cd1ad69c5159e7bb35d9eb3bdd41eae8e954495.html",
        "sha256": "efd7a2bb781ad1e3dbc514807cd1ad69c5159e7bb35d9eb3bdd41eae8e954495",
        "bodyArtifactPath": "artifacts/v6/content-research/frozen-source-text/133740676c07858dadee220090d2c77b7d06364812efc29eb924db8d4412ae8d.txt",
        "bodySha256": "133740676c07858dadee220090d2c77b7d06364812efc29eb924db8d4412ae8d",
        "locator": "Experiment页LOCKING MECHANISM Results and Discussion、Fig6/7前后原文；作者解释与独立验证分开。",
        "anchors": [
          {
            "text": "the largest structure of 1+2+3+4 could not form"
          },
          {
            "text": "to be 34nt in length."
          },
          {
            "text": "ready to be replicated in an azobenzene-controlled fashion."
          }
        ]
      }
    ]
  },
  {
    "ownerId": "apple-swift-student-challenge:2026:app-playground:individual-student:global-2026:v3",
    "ownerSeriesId": "apple-swift-student-challenge",
    "ownerCatalogVersion": "saitu.catalog.v3.20261105.1",
    "fact": {
      "id": "apple-swift-student-challenge:material:v734:voiceover-input-feedback",
      "field": "material.voiceover_input_feedback",
      "text": "作者公开的2025项目Accessibility Escape在VoiceOver关卡给图片设置无障碍标签。源码将文本输入转为小写，匹配apple时将本关标记为解开，其他输入对应未解开。",
      "kind": "participant_report",
      "status": "historical",
      "sourceIds": [
        "swift-accessibility-2025-full"
      ],
      "scope": "作者标记为Swift Student Challenge 2025的完整源代码/本地素材；不认证获奖或2026合规",
      "sourceScopes": [
        {
          "sourceId": "swift-accessibility-2025-full",
          "scope": "作者标记为Swift Student Challenge 2025的完整源代码/本地素材；不认证获奖或2026合规"
        }
      ],
      "checkedAt": "2026-11-05",
      "supersedes": [],
      "conflictsWith": [],
      "entity": {
        "editionId": "2026",
        "trackId": "app-playground",
        "groupId": "individual-student",
        "scopeId": "global-2026"
      },
      "lastVerifiedAt": "2026-11-05"
    },
    "sources": [
      {
        "id": "swift-accessibility-2025-full",
        "url": "https://github.com/phnagy/ssc2025/tree/960b72301329ff8dd5f67801eca8d9a8240fabe7",
        "title": "Accessibility Escape：作者完整2025公开项目",
        "publisher": "Philipp Nagy（项目作者）",
        "scope": "作者标记为Swift Student Challenge 2025的完整源代码/本地素材；不认证获奖或2026合规",
        "locator": "锁定commit的README、Package.swift、五个Level视图、Model/Level、LevelViewModifier、指南及三张作者截图",
        "publishedAt": "2025",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "accessStatus": "body_read",
        "authority": "other",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/continuation-20261105/content/source-rechecks-batch05/reading-log.json",
        "publicationDate": {
          "raw": "2025",
          "value": "2025",
          "precision": "year",
          "timezone": null
        }
      }
    ],
    "sourceProofs": [
      {
        "sourceId": "swift-accessibility-2025-full",
        "artifactPath": "artifacts/v6/content-research/source-byte-snapshots/4754f90fc7d6ce15629196fba624981a152b8a2228b9d77e2b03207a6979cc04.zip",
        "sha256": "4754f90fc7d6ce15629196fba624981a152b8a2228b9d77e2b03207a6979cc04",
        "bodyArtifactPath": "artifacts/v6/content-research/frozen-source-text/311426ec11e718e5a64e6d84bccacda427756d13c4fadeaf5db26327303cf23b.txt",
        "bodySha256": "311426ec11e718e5a64e6d84bccacda427756d13c4fadeaf5db26327303cf23b",
        "locator": "冻ZIP内 AccessibilityEscape.swiftpm/Level Subsystem/Levels/LevelVoiceOverView.swift 与 README.md；合并冻文2118–2182、3312–3315。",
        "anchors": [
          {
            "text": "# Swift Student Challenge 2025"
          },
          {
            "text": ".accessibilityLabel(\"Apples hanging from a tree\")"
          },
          {
            "text": "if text.lowercased() == \"apple\" {"
          },
          {
            "text": "solved = true"
          },
          {
            "text": "solved = false"
          }
        ]
      }
    ]
  },
  {
    "ownerId": "cfa-research-challenge:2024-2025-historical:equity-research:university-team:global-2024-2025-report:v3",
    "ownerSeriesId": "cfa-research-challenge",
    "ownerCatalogVersion": "saitu.catalog.v3.20261105.1",
    "fact": {
      "id": "cfa-research-challenge:material:v734:dom-development-valuation-basis",
      "field": "material.dom_development_valuation_basis",
      "text": "2025年Kozminski团队的Dom Development公开报告在估值部分列出现金流折现、相对估值、股利折现和分部加总，最终目标价的权重全部给现金流折现，相对估值只作旁证。",
      "kind": "participant_report",
      "status": "historical",
      "sourceIds": [
        "b-cfa-report"
      ],
      "scope": "CFA官网公开的2025 Kozminski作者报告；属于作品证据，不是资格规则",
      "sourceScopes": [
        {
          "sourceId": "b-cfa-report",
          "scope": "CFA官网公开的2025 Kozminski作者报告；属于作品证据，不是资格规则"
        }
      ],
      "checkedAt": "2026-11-05",
      "supersedes": [],
      "conflictsWith": [],
      "entity": {
        "editionId": "2024-2025-historical",
        "trackId": "equity-research",
        "groupId": "university-team",
        "scopeId": "global-2024-2025-report"
      },
      "lastVerifiedAt": "2026-11-05"
    },
    "sources": [
      {
        "id": "b-cfa-report",
        "url": "https://www.cfainstitute.org/sites/default/files/docs/insights/events/research-challenge/rc-2025-winning-written-report-kozminski-university.pdf",
        "title": "2025 Kozminski University完整获奖研究报告",
        "publisher": "CFA Institute",
        "scope": "CFA官网公开的2025 Kozminski作者报告；属于作品证据，不是资格规则",
        "locator": "投资摘要、估值、风险、敏感性及附录",
        "authority": "other",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "publishedAt": null,
        "accessStatus": "body_read",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/v6/content-research/arts-business-b-reading-log.json",
        "publicationDate": {
          "raw": null,
          "value": null,
          "precision": "unknown",
          "timezone": null
        }
      }
    ],
    "sourceProofs": [
      {
        "sourceId": "b-cfa-report",
        "artifactPath": "artifacts/v6/content-research/source-byte-snapshots/140198578dea7d0f0f7b6270082655b54f52763bd3d4d8db3e2d4f48e85bfebb.pdf",
        "sha256": "140198578dea7d0f0f7b6270082655b54f52763bd3d4d8db3e2d4f48e85bfebb",
        "bodyArtifactPath": "artifacts/v6/content-research/frozen-source-text/cf3f5cda6237dd097000947cdc32c87ac63261cd9000011a712fc17c0f0f8530.txt",
        "bodySha256": "cf3f5cda6237dd097000947cdc32c87ac63261cd9000011a712fc17c0f0f8530",
        "locator": "PDF封面p1、Executive Summary p2、Valuation p9及Relative Valuation p10；冻文5–9、59–63、916–921、1064–1071。",
        "anchors": [
          {
            "page": 1,
            "text": "Kozminski University"
          },
          {
            "page": 2,
            "text": "The target price is solely based on DCF valuation"
          },
          {
            "page": 9,
            "text": "DCF, relative valuation, DDM, and the sum of the parts"
          },
          {
            "page": 9,
            "text": "assign a 100% weight to the DCF approach"
          },
          {
            "page": 10,
            "text": "The relative valuation was not used for the final price calculation"
          }
        ]
      }
    ]
  },
  {
    "ownerId": "igem-collegiate:2026-collegiate:model-evidence:higher-education:igem-2026-higher-education:v3",
    "ownerSeriesId": "igem-collegiate",
    "ownerCatalogVersion": "saitu.catalog.v3.20261105.1",
    "fact": {
      "id": "igem-collegiate:material:v734:hkust-structure-prediction-scope",
      "field": "material.hkust_structure_prediction_scope",
      "text": "HKUST2025团队公开Model页的MT Cycle 0记载，团队预测候选结构并用模型置信度指标比较结果，页面另列预测局限。",
      "kind": "participant_report",
      "status": "historical",
      "sourceIds": [
        "igem-2025-hkust-model"
      ],
      "scope": "2025作者公开研究的建模模块；仅作2026准备案例，不沿用旧规则",
      "sourceScopes": [
        {
          "sourceId": "igem-2025-hkust-model",
          "scope": "2025作者公开研究的建模模块；仅作2026准备案例，不沿用旧规则"
        }
      ],
      "checkedAt": "2026-11-05",
      "supersedes": [],
      "conflictsWith": [],
      "entity": {
        "editionId": "2026-collegiate",
        "trackId": "model-evidence",
        "groupId": "higher-education",
        "scopeId": "igem-2026-higher-education"
      },
      "lastVerifiedAt": "2026-11-05"
    },
    "sources": [
      {
        "id": "igem-2025-hkust-model",
        "url": "https://2025.igem.wiki/hkust/model",
        "title": "HKUST2025公开Model作品：金属结合模型",
        "publisher": "HKUST iGEM2025团队",
        "scope": "2025作者公开研究的建模模块；仅作2026准备案例，不沿用旧规则",
        "locator": "完整Model页面：MT Cycle0、1A、1B、2、Biosensor及Kill Switch；原HTML及全部模型图像单独冻结",
        "publishedAt": "2025",
        "checkedAt": "2026-11-05",
        "retrievedAt": "2026-11-05",
        "accessStatus": "body_read",
        "authority": "other",
        "verificationMethod": "agent_web_read",
        "integrity": "consistent",
        "evidenceArtifact": "artifacts/continuation-20261105/content/source-rechecks-batch02/reading-log.json",
        "publicationDate": {
          "raw": "2025",
          "value": "2025",
          "precision": "year",
          "timezone": null
        }
      }
    ],
    "sourceProofs": [
      {
        "sourceId": "igem-2025-hkust-model",
        "artifactPath": "artifacts/v6/content-research/source-byte-snapshots/43ac4d99fdaf07521e20cae33dedee8f2ecae59100c1752c28c643e65388934d.html",
        "sha256": "43ac4d99fdaf07521e20cae33dedee8f2ecae59100c1752c28c643e65388934d",
        "bodyArtifactPath": "artifacts/v6/content-research/frozen-source-text/ee804f87805796fef92dbd5e7594a02ff835beb9fe5c07be306846f3ff19dc7a.txt",
        "bodySha256": "ee804f87805796fef92dbd5e7594a02ff835beb9fe5c07be306846f3ff19dc7a",
        "locator": "冻作者HTML的Model页，MT Cycle 0计算结构段（冻文51–56）及 Learn: Limitations Regarding the Predictions（冻文186起）。",
        "anchors": [
          {
            "text": "MT Cycle 0"
          },
          {
            "text": "A key aspect of our selection process involved predicting the structures of candidate proteins"
          },
          {
            "text": "pLDDT scores provide confidence levels"
          },
          {
            "text": "Learn: Limitations Regarding the Predictions"
          }
        ]
      }
    ]
  }
];

/** Load the exact independently reviewed snapshot, never filter mutable
 * candidates by ID or derive expected approval bytes from those candidates. */
export const APPROVED_PUBLISHED_WORK_FACT_IDS_V734: readonly string[] =
  Object.keys(reviewedPublishedWorkBindingsV734);
export const approvedPublishedWorkFactsV734: readonly PublishedWorkFactBindingV734[] =
  Object.values(reviewedPublishedWorkBindingsV734).map(value => JSON.parse(value) as PublishedWorkFactBindingV734);
