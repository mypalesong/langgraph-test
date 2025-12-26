---
sidebar_position: 4
---

# Vector Store 연동

벡터 스토어를 연동하여 RAG(Retrieval-Augmented Generation) 시스템을 구축하는 방법을 알아봅니다.

## 벡터 스토어란?

벡터 스토어는 텍스트를 고차원 벡터(임베딩)로 변환하여 저장하고, 유사도 기반 검색을 수행하는 데이터베이스입니다.

```
┌─────────────────────────────────────────────────────────────┐
│                    RAG Pipeline                              │
│                                                              │
│  ┌────────┐   ┌────────────┐   ┌────────────┐   ┌────────┐ │
│  │  Query │──▶│  Embedding │──▶│   Vector   │──▶│  LLM   │ │
│  │        │   │   Model    │   │   Search   │   │ + Docs │ │
│  └────────┘   └────────────┘   └────────────┘   └────────┘ │
│                                      │                       │
│                                      ▼                       │
│                              ┌──────────────┐               │
│                              │ Vector Store │               │
│                              │  (Chroma,    │               │
│                              │  Pinecone,   │               │
│                              │  FAISS)      │               │
│                              └──────────────┘               │
└─────────────────────────────────────────────────────────────┘
```

## Chroma DB 연동

### 설치

```bash
pip install chromadb langchain-chroma
```

### 기본 설정

```python
from langchain_chroma import Chroma
from langchain_openai import OpenAIEmbeddings

# 임베딩 모델
embeddings = OpenAIEmbeddings(model="text-embedding-3-small")

# 영구 저장소 사용
vectorstore = Chroma(
    collection_name="my_documents",
    embedding_function=embeddings,
    persist_directory="./chroma_db"
)

# 메모리 기반 (테스트용)
vectorstore_memory = Chroma(
    collection_name="test",
    embedding_function=embeddings
)
```

### 문서 추가

```python
from langchain_core.documents import Document

# 단일 문서 추가
doc = Document(
    page_content="LangGraph는 상태 기반 멀티 에이전트 워크플로우를 구축합니다.",
    metadata={"source": "langgraph_docs", "chapter": 1}
)
vectorstore.add_documents([doc])

# 여러 문서 추가
docs = [
    Document(page_content="Python은 프로그래밍 언어입니다.", metadata={"topic": "python"}),
    Document(page_content="FastAPI는 웹 프레임워크입니다.", metadata={"topic": "web"}),
]
vectorstore.add_documents(docs)
```

### 검색

```python
# 유사도 검색
results = vectorstore.similarity_search("LangGraph가 뭔가요?", k=3)
for doc in results:
    print(doc.page_content)

# 점수와 함께 검색
results_with_scores = vectorstore.similarity_search_with_score("프로그래밍", k=3)
for doc, score in results_with_scores:
    print(f"Score: {score:.4f} - {doc.page_content}")

# 필터링된 검색
results = vectorstore.similarity_search(
    "웹 개발",
    k=3,
    filter={"topic": "web"}
)
```

## LangGraph에서 RAG 구현

### 기본 RAG 그래프

```python
from typing import TypedDict, Annotated, Sequence
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_chroma import Chroma
from langgraph.graph import StateGraph, END, START
from langgraph.graph.message import add_messages

# 벡터 스토어 초기화
embeddings = OpenAIEmbeddings()
vectorstore = Chroma(
    collection_name="documents",
    embedding_function=embeddings,
    persist_directory="./chroma_db"
)

# Retriever 생성
retriever = vectorstore.as_retriever(
    search_type="similarity",
    search_kwargs={"k": 5}
)

class RAGState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]
    context: list[str]

llm = ChatOpenAI(model="gpt-4o-mini")

def retrieve(state: RAGState) -> dict:
    """관련 문서를 검색하는 노드"""
    question = state["messages"][-1].content
    docs = retriever.invoke(question)
    context = [doc.page_content for doc in docs]
    return {"context": context}

def generate(state: RAGState) -> dict:
    """컨텍스트 기반으로 답변을 생성하는 노드"""
    context = "\n\n".join(state["context"])
    question = state["messages"][-1].content

    prompt = f"""다음 컨텍스트를 참고하여 질문에 답변하세요.

컨텍스트:
{context}

질문: {question}

답변:"""

    response = llm.invoke(prompt)
    return {"messages": [AIMessage(content=response.content)]}

# 그래프 구성
graph = StateGraph(RAGState)
graph.add_node("retrieve", retrieve)
graph.add_node("generate", generate)

graph.add_edge(START, "retrieve")
graph.add_edge("retrieve", "generate")
graph.add_edge("generate", END)

rag_app = graph.compile()
```

### 고급 RAG: 쿼리 재작성

```python
class AdvancedRAGState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]
    original_query: str
    rewritten_query: str
    context: list[str]

def rewrite_query(state: AdvancedRAGState) -> dict:
    """검색에 최적화된 쿼리로 재작성"""
    original = state["messages"][-1].content

    prompt = f"""다음 질문을 검색에 최적화된 형태로 재작성하세요.
핵심 키워드를 포함하고, 불필요한 표현은 제거하세요.

원본 질문: {original}
재작성된 쿼리:"""

    response = llm.invoke(prompt)
    return {
        "original_query": original,
        "rewritten_query": response.content.strip()
    }

def retrieve_with_rewritten(state: AdvancedRAGState) -> dict:
    """재작성된 쿼리로 검색"""
    query = state["rewritten_query"]
    docs = retriever.invoke(query)
    return {"context": [doc.page_content for doc in docs]}

def generate_with_sources(state: AdvancedRAGState) -> dict:
    """출처와 함께 답변 생성"""
    context = "\n\n".join(state["context"])
    question = state["original_query"]

    prompt = f"""컨텍스트를 참고하여 질문에 답변하고, 출처를 명시하세요.

컨텍스트:
{context}

질문: {question}"""

    response = llm.invoke(prompt)
    return {"messages": [AIMessage(content=response.content)]}

# 그래프 구성
graph = StateGraph(AdvancedRAGState)
graph.add_node("rewrite", rewrite_query)
graph.add_node("retrieve", retrieve_with_rewritten)
graph.add_node("generate", generate_with_sources)

graph.add_edge(START, "rewrite")
graph.add_edge("rewrite", "retrieve")
graph.add_edge("retrieve", "generate")
graph.add_edge("generate", END)

advanced_rag = graph.compile()
```

### Self-RAG: 검색 필요성 판단

```python
from typing import Literal

class SelfRAGState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]
    needs_retrieval: bool
    context: list[str]

def classify_query(state: SelfRAGState) -> dict:
    """검색이 필요한지 판단"""
    question = state["messages"][-1].content

    prompt = f"""다음 질문에 답하기 위해 외부 문서 검색이 필요한지 판단하세요.
일반 상식이나 간단한 계산은 검색 불필요.
특정 사실, 최신 정보, 전문 지식은 검색 필요.

질문: {question}

답변 (yes/no):"""

    response = llm.invoke(prompt)
    needs_retrieval = "yes" in response.content.lower()
    return {"needs_retrieval": needs_retrieval}

def route_by_need(state: SelfRAGState) -> Literal["retrieve", "direct"]:
    """검색 필요 여부에 따라 라우팅"""
    if state["needs_retrieval"]:
        return "retrieve"
    return "direct"

def direct_answer(state: SelfRAGState) -> dict:
    """검색 없이 직접 답변"""
    question = state["messages"][-1].content
    response = llm.invoke(question)
    return {"messages": [AIMessage(content=response.content)]}

# 그래프 구성
graph = StateGraph(SelfRAGState)
graph.add_node("classify", classify_query)
graph.add_node("retrieve", retrieve)
graph.add_node("generate", generate)
graph.add_node("direct", direct_answer)

graph.add_edge(START, "classify")
graph.add_conditional_edges("classify", route_by_need, {
    "retrieve": "retrieve",
    "direct": "direct"
})
graph.add_edge("retrieve", "generate")
graph.add_edge("generate", END)
graph.add_edge("direct", END)

self_rag = graph.compile()
```

## Pinecone 연동

대규모 벡터 검색을 위한 Pinecone 연동:

```bash
pip install pinecone-client langchain-pinecone
```

```python
from pinecone import Pinecone
from langchain_pinecone import PineconeVectorStore
from langchain_openai import OpenAIEmbeddings

# Pinecone 초기화
pc = Pinecone(api_key="your-api-key")

# 인덱스 연결
index = pc.Index("my-index")

# 벡터 스토어 생성
embeddings = OpenAIEmbeddings()
vectorstore = PineconeVectorStore(
    index=index,
    embedding=embeddings,
    text_key="text"
)

# 검색
retriever = vectorstore.as_retriever(search_kwargs={"k": 10})
```

## 문서 청킹 전략

```python
from langchain.text_splitter import RecursiveCharacterTextSplitter

# 문자 기반 분할
text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=200,
    separators=["\n\n", "\n", " ", ""]
)

# 시맨틱 분할
from langchain_experimental.text_splitter import SemanticChunker

semantic_splitter = SemanticChunker(
    embeddings=OpenAIEmbeddings(),
    breakpoint_threshold_type="percentile"
)

# 문서 분할
text = "긴 문서 내용..."
chunks = text_splitter.split_text(text)

# 문서 객체로 분할
from langchain_core.documents import Document
doc = Document(page_content=text, metadata={"source": "file.pdf"})
docs = text_splitter.split_documents([doc])
```

## 전체 RAG 파이프라인 예제

```python
from typing import TypedDict, Annotated, Sequence
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langchain_core.documents import Document
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_chroma import Chroma
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langgraph.graph import StateGraph, END, START
from langgraph.graph.message import add_messages
from langgraph.checkpoint.memory import MemorySaver

# 초기 설정
embeddings = OpenAIEmbeddings()
vectorstore = Chroma(
    collection_name="knowledge_base",
    embedding_function=embeddings,
    persist_directory="./knowledge_db"
)
retriever = vectorstore.as_retriever(search_kwargs={"k": 5})
llm = ChatOpenAI(model="gpt-4o-mini")

class KnowledgeState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]
    context: list[str]
    sources: list[str]

def retrieve_knowledge(state: KnowledgeState) -> dict:
    question = state["messages"][-1].content
    docs = retriever.invoke(question)
    return {
        "context": [doc.page_content for doc in docs],
        "sources": [doc.metadata.get("source", "unknown") for doc in docs]
    }

def generate_answer(state: KnowledgeState) -> dict:
    context = "\n---\n".join(state["context"])
    sources = list(set(state["sources"]))
    question = state["messages"][-1].content

    prompt = f"""당신은 지식 기반 어시스턴트입니다.
주어진 컨텍스트만을 사용하여 질문에 답변하세요.
컨텍스트에 없는 내용은 "해당 정보가 없습니다"라고 답하세요.

컨텍스트:
{context}

질문: {question}

답변:"""

    response = llm.invoke(prompt)
    answer = response.content

    if sources:
        answer += f"\n\n📚 참고 자료: {', '.join(sources)}"

    return {"messages": [AIMessage(content=answer)]}

# 그래프 구성
graph = StateGraph(KnowledgeState)
graph.add_node("retrieve", retrieve_knowledge)
graph.add_node("generate", generate_answer)

graph.add_edge(START, "retrieve")
graph.add_edge("retrieve", "generate")
graph.add_edge("generate", END)

# 메모리 추가
memory = MemorySaver()
knowledge_app = graph.compile(checkpointer=memory)

# 사용
result = knowledge_app.invoke(
    {
        "messages": [HumanMessage(content="LangGraph에서 상태 관리는 어떻게 하나요?")],
        "context": [],
        "sources": []
    },
    config={"configurable": {"thread_id": "user-1"}}
)
print(result["messages"][-1].content)
```

## 다음 단계

다음 섹션에서는 LangGraph를 백엔드 서버로 구축하는 방법을 알아봅니다.
