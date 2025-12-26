import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'LangGraph Guide',
  tagline: 'LangGraph를 활용한 AI 애플리케이션 개발 가이드',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://mypalesong.github.io',
  baseUrl: '/langgraph-test/',

  organizationName: 'mypalesong',
  projectName: 'langgraph-test',
  deploymentBranch: 'guide-pages',
  trailingSlash: false,

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'ko',
    locales: ['ko'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/mypalesong/langgraph-test/tree/guide/',
          routeBasePath: '/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/langgraph-social-card.png',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'LangGraph Guide',
      logo: {
        alt: 'LangGraph Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: '가이드',
        },
        {
          href: 'https://github.com/mypalesong/langgraph-test',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: '문서',
          items: [
            {
              label: '시작하기',
              to: '/',
            },
            {
              label: '기본 개념',
              to: '/basics/what-is-langgraph',
            },
          ],
        },
        {
          title: '참고 자료',
          items: [
            {
              label: 'LangGraph 공식 문서',
              href: 'https://langchain-ai.github.io/langgraph/',
            },
            {
              label: 'LangChain',
              href: 'https://python.langchain.com/',
            },
          ],
        },
        {
          title: '더 보기',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/mypalesong/langgraph-test',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} LangGraph Guide. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['python', 'bash', 'json'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
