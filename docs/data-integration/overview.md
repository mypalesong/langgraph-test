---
sidebar_position: 1
---

# 외부 데이터 연동 개요

LangGraph 애플리케이션에서 외부 데이터 소스와 연동하는 방법을 알아봅니다.

## 왜 외부 데이터 연동이 필요한가?

LLM은 학습 데이터에 기반하여 응답하므로 다음과 같은 한계가 있습니다:

1. **최신 정보 부족**: 학습 데이터 이후의 정보를 알지 못함
2. **도메인 특화 지식 부재**: 회사 내부 문서, 전문 분야 데이터 등
3. **개인화 불가**: 사용자별 데이터에 접근 불가

외부 데이터 연동을 통해 이러한 한계를 극복할 수 있습니다.

## 데이터 연동 아키텍처

```
┌──────────────────────────────────────────────────────────────┐
│                      LangGraph Application                    │
│                                                               │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐        │
│  │  Agent Node │───│ Retriever   │───│  Tool Node  │        │
│  └─────────────┘   │    Node     │   └─────────────┘        │
│         │          └──────┬──────┘          │                │
│         │                 │                 │                │
└─────────┼─────────────────┼─────────────────┼────────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
    ┌──────────┐     ┌──────────┐     ┌──────────┐
    │ Database │     │  Vector  │     │ External │
    │          │     │  Store   │     │   API    │
    └──────────┘     └──────────┘     └──────────┘
```

## 연동 방식

### 1. 도구(Tool)로 연동

외부 데이터 소스를 도구로 래핑하여 에이전트가 필요할 때 호출:

```python
from langchain_core.tools import tool

@tool
def query_database(query: str) -> str:
    """데이터베이스에서 정보를 조회합니다."""
    # 데이터베이스 쿼리 실행
    result = db.execute(query)
    return str(result)

@tool
def search_documents(query: str) -> str:
    """문서를 검색합니다."""
    docs = vector_store.similarity_search(query)
    return "\n".join([doc.page_content for doc in docs])
```

### 2. 노드 내에서 직접 연동

특정 노드에서 직접 데이터 소스에 접근:

```python
def data_retrieval_node(state: State) -> dict:
    """데이터를 가져오는 전용 노드"""
    query = state["query"]

    # 데이터베이스 조회
    db_results = database.query(query)

    # 벡터 검색
    similar_docs = vector_store.search(query, k=5)

    return {
        "context": db_results + similar_docs
    }
```

### 3. 조건부 데이터 연동

상태에 따라 다른 데이터 소스 선택:

```python
def route_to_datasource(state: State) -> str:
    query_type = state.get("query_type")

    if query_type == "structured":
        return "sql_database"
    elif query_type == "semantic":
        return "vector_store"
    else:
        return "api"

graph.add_conditional_edges(
    "classifier",
    route_to_datasource,
    {
        "sql_database": "db_node",
        "vector_store": "retriever_node",
        "api": "api_node"
    }
)
```

## 지원하는 데이터 소스

| 데이터 소스 | 용도 | 연동 방법 |
|------------|------|----------|
| PostgreSQL | 구조화된 데이터 | SQLAlchemy, asyncpg |
| MongoDB | 비정형 데이터 | pymongo |
| Redis | 캐시, 세션 | redis-py |
| Elasticsearch | 전문 검색 | elasticsearch-py |
| Chroma | 벡터 검색 | chromadb |
| Pinecone | 대규모 벡터 검색 | pinecone-client |
| REST API | 외부 서비스 | httpx, aiohttp |
| GraphQL | 복잡한 데이터 쿼리 | gql |

## 기본 패턴

### RAG (Retrieval-Augmented Generation)

```python
class RAGState(TypedDict):
    question: str
    context: list[str]
    answer: str

def retrieve(state: RAGState) -> dict:
    """관련 문서 검색"""
    docs = retriever.invoke(state["question"])
    return {"context": [d.page_content for d in docs]}

def generate(state: RAGState) -> dict:
    """컨텍스트 기반 답변 생성"""
    context = "\n".join(state["context"])
    prompt = f"Context: {context}\n\nQuestion: {state['question']}"
    answer = llm.invoke(prompt)
    return {"answer": answer.content}

graph = StateGraph(RAGState)
graph.add_node("retrieve", retrieve)
graph.add_node("generate", generate)
graph.add_edge(START, "retrieve")
graph.add_edge("retrieve", "generate")
graph.add_edge("generate", END)
```

### 다중 데이터 소스 통합

```python
class MultiSourceState(TypedDict):
    query: str
    db_results: list[dict]
    api_results: list[dict]
    vector_results: list[str]
    final_context: str

# 병렬 데이터 수집
async def fetch_all_data(state: MultiSourceState) -> dict:
    query = state["query"]

    # 병렬 실행
    db_task = asyncio.create_task(fetch_from_db(query))
    api_task = asyncio.create_task(fetch_from_api(query))
    vector_task = asyncio.create_task(fetch_from_vectors(query))

    db_results, api_results, vector_results = await asyncio.gather(
        db_task, api_task, vector_task
    )

    return {
        "db_results": db_results,
        "api_results": api_results,
        "vector_results": vector_results
    }
```

## 다음 단계

다음 섹션에서는 구체적인 데이터베이스 연동 방법을 살펴봅니다.
