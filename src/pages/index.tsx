import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/">
            시작하기
          </Link>
        </div>
      </div>
    </header>
  );
}

type FeatureItem = {
  title: string;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: '상태 기반 워크플로우',
    description: (
      <>
        LangGraph는 그래프 기반의 상태 관리를 통해 복잡한 AI 워크플로우를
        쉽게 구축할 수 있게 해줍니다.
      </>
    ),
  },
  {
    title: '외부 데이터 연동',
    description: (
      <>
        데이터베이스, API, 벡터 스토어 등 다양한 외부 데이터 소스와
        손쉽게 연동하여 RAG 시스템을 구축할 수 있습니다.
      </>
    ),
  },
  {
    title: '프로덕션 레디',
    description: (
      <>
        FastAPI 통합, 상태 영속성, 실시간 스트리밍 등 프로덕션 환경에
        필요한 모든 기능을 제공합니다.
      </>
    ),
  },
];

function Feature({title, description}: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title="홈"
      description="LangGraph를 활용한 AI 애플리케이션 개발 가이드">
      <HomepageHeader />
      <main>
        <HomepageFeatures />
      </main>
    </Layout>
  );
}
