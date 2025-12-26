import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  tutorialSidebar: [
    'intro',
    {
      type: 'category',
      label: '기본 개념',
      items: [
        'basics/what-is-langgraph',
        'basics/installation',
        'basics/core-concepts',
        'basics/first-graph',
      ],
    },
    {
      type: 'category',
      label: '외부 데이터 연동',
      items: [
        'data-integration/overview',
        'data-integration/database',
        'data-integration/api-integration',
        'data-integration/vector-store',
      ],
    },
    {
      type: 'category',
      label: '백엔드 구축',
      items: [
        'backend/architecture',
        'backend/fastapi-integration',
        'backend/state-persistence',
        'backend/streaming',
      ],
    },
    {
      type: 'category',
      label: '고급 기능',
      items: [
        'advanced/human-in-the-loop',
        'advanced/subgraphs',
        'advanced/checkpointing',
      ],
    },
  ],
};

export default sidebars;
