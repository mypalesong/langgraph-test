---
sidebar_position: 2
---

# 서브그래프

복잡한 워크플로우를 모듈화하기 위해 서브그래프를 활용하는 방법을 알아봅니다.

## 서브그래프란?

서브그래프는 그래프 안에 포함된 또 다른 그래프입니다. 복잡한 로직을 캡슐화하고 재사용할 수 있습니다.

```
┌─────────────────────────────────────────────────────────────┐
│                      Main Graph                              │
│                                                              │
│  ┌─────────┐   ┌─────────────────────────────┐   ┌───────┐ │
│  │  Node A │──▶│       Subgraph             │──▶│ Node C│ │
│  └─────────┘   │  ┌───────┐   ┌───────┐    │   └───────┘ │
│                │  │ Sub A │──▶│ Sub B │    │              │
│                │  └───────┘   └───────┘    │              │
│                └─────────────────────────────┘              │
└─────────────────────────────────────────────────────────────┘
```

## 기본 서브그래프 구현

### 서브그래프 정의

```python
from typing import TypedDict, Annotated
from langgraph.graph import StateGraph, END, START

# 서브그래프 상태
class ResearchState(TypedDict):
    query: str
    search_results: list[str]
    summary: str

def search_node(state: ResearchState) -> dict:
    """검색 수행"""
    results = [f"Result for: {state['query']}"]
    return {"search_results": results}

def summarize_node(state: ResearchState) -> dict:
    """결과 요약"""
    summary = f"Summary of {len(state['search_results'])} results"
    return {"summary": summary}

# 서브그래프 생성
research_graph = StateGraph(ResearchState)
research_graph.add_node("search", search_node)
research_graph.add_node("summarize", summarize_node)
research_graph.add_edge(START, "search")
research_graph.add_edge("search", "summarize")
research_graph.add_edge("summarize", END)

# 컴파일
research_subgraph = research_graph.compile()
```

### 메인 그래프에서 사용

```python
from langchain_core.messages import BaseMessage, HumanMessage
from langgraph.graph.message import add_messages
from typing import Sequence

# 메인 그래프 상태
class MainState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]
    research_result: str

def extract_query(state: MainState) -> dict:
    """사용자 메시지에서 검색어 추출"""
    query = state["messages"][-1].content
    return {"query": query}

def call_research(state: MainState) -> dict:
    """리서치 서브그래프 호출"""
    # 서브그래프용 상태 준비
    research_input = {
        "query": state["messages"][-1].content,
        "search_results": [],
        "summary": ""
    }

    # 서브그래프 실행
    result = research_subgraph.invoke(research_input)

    return {"research_result": result["summary"]}

def respond(state: MainState) -> dict:
    """최종 응답 생성"""
    from langchain_core.messages import AIMessage
    response = f"Research complete: {state['research_result']}"
    return {"messages": [AIMessage(content=response)]}

# 메인 그래프 구성
main_graph = StateGraph(MainState)
main_graph.add_node("research", call_research)
main_graph.add_node("respond", respond)
main_graph.add_edge(START, "research")
main_graph.add_edge("research", "respond")
main_graph.add_edge("respond", END)

app = main_graph.compile()
```

## 상태 공유

### 공유 상태 스키마

```python
from typing import TypedDict, Annotated

# 공유 가능한 상태 필드
class SharedState(TypedDict):
    user_id: str
    context: dict

# 서브그래프 고유 상태
class AnalysisState(SharedState):
    data: list
    analysis_result: str

# 메인 그래프 상태
class OrchestratorState(SharedState):
    task: str
    final_result: str

def analysis_subgraph_node(state: OrchestratorState) -> dict:
    """분석 서브그래프를 호출하고 결과를 변환"""

    # 서브그래프 입력 준비
    analysis_input: AnalysisState = {
        "user_id": state["user_id"],
        "context": state["context"],
        "data": [],
        "analysis_result": ""
    }

    result = analysis_graph.invoke(analysis_input)

    return {
        "final_result": result["analysis_result"],
        "context": result["context"]  # 업데이트된 컨텍스트
    }
```

## 병렬 서브그래프

여러 서브그래프를 병렬로 실행:

```python
import asyncio

class ParallelState(TypedDict):
    query: str
    web_results: list[str]
    db_results: list[str]
    combined: str

# 웹 검색 서브그래프
web_search_graph = create_web_search_graph()

# DB 검색 서브그래프
db_search_graph = create_db_search_graph()

async def parallel_search(state: ParallelState) -> dict:
    """두 서브그래프를 병렬로 실행"""
    query = state["query"]

    # 병렬 실행
    web_task = asyncio.create_task(
        web_search_graph.ainvoke({"query": query})
    )
    db_task = asyncio.create_task(
        db_search_graph.ainvoke({"query": query})
    )

    web_result, db_result = await asyncio.gather(web_task, db_task)

    return {
        "web_results": web_result.get("results", []),
        "db_results": db_result.get("results", [])
    }

def combine_results(state: ParallelState) -> dict:
    """결과 병합"""
    all_results = state["web_results"] + state["db_results"]
    combined = f"Found {len(all_results)} total results"
    return {"combined": combined}

# 메인 그래프
main_graph = StateGraph(ParallelState)
main_graph.add_node("parallel_search", parallel_search)
main_graph.add_node("combine", combine_results)
main_graph.add_edge(START, "parallel_search")
main_graph.add_edge("parallel_search", "combine")
main_graph.add_edge("combine", END)
```

## 조건부 서브그래프 호출

```python
from typing import Literal

class TaskState(TypedDict):
    task_type: str
    input_data: dict
    result: str

# 각 작업 유형별 서브그래프
code_review_graph = create_code_review_graph()
translation_graph = create_translation_graph()
summarization_graph = create_summarization_graph()

def route_to_subgraph(state: TaskState) -> Literal["code", "translate", "summarize"]:
    """작업 유형에 따라 라우팅"""
    task_type = state["task_type"]
    routing = {
        "code_review": "code",
        "translation": "translate",
        "summarization": "summarize"
    }
    return routing.get(task_type, "summarize")

async def code_review_node(state: TaskState) -> dict:
    result = await code_review_graph.ainvoke(state["input_data"])
    return {"result": result["review"]}

async def translation_node(state: TaskState) -> dict:
    result = await translation_graph.ainvoke(state["input_data"])
    return {"result": result["translated"]}

async def summarization_node(state: TaskState) -> dict:
    result = await summarization_graph.ainvoke(state["input_data"])
    return {"result": result["summary"]}

graph = StateGraph(TaskState)
graph.add_node("code", code_review_node)
graph.add_node("translate", translation_node)
graph.add_node("summarize", summarization_node)

graph.add_conditional_edges(START, route_to_subgraph, {
    "code": "code",
    "translate": "translate",
    "summarize": "summarize"
})
graph.add_edge("code", END)
graph.add_edge("translate", END)
graph.add_edge("summarize", END)
```

## 재귀적 서브그래프

서브그래프가 자기 자신을 호출:

```python
class RecursiveState(TypedDict):
    problem: str
    sub_problems: list[str]
    solutions: list[str]
    depth: int
    max_depth: int

def decompose_problem(state: RecursiveState) -> dict:
    """문제를 하위 문제로 분해"""
    if state["depth"] >= state["max_depth"]:
        return {"sub_problems": []}

    # LLM을 사용하여 문제 분해
    sub_problems = llm_decompose(state["problem"])
    return {"sub_problems": sub_problems}

def solve_or_recurse(state: RecursiveState) -> Literal["solve", "recurse", "end"]:
    """직접 해결할지 재귀할지 결정"""
    if not state["sub_problems"]:
        return "end"

    if is_simple_problem(state["sub_problems"][0]):
        return "solve"

    return "recurse"

def solve_directly(state: RecursiveState) -> dict:
    """간단한 문제 직접 해결"""
    solutions = []
    for problem in state["sub_problems"]:
        solution = llm_solve(problem)
        solutions.append(solution)
    return {"solutions": state["solutions"] + solutions}

def recurse_subgraph(state: RecursiveState) -> dict:
    """서브그래프 재귀 호출"""
    all_solutions = []

    for sub_problem in state["sub_problems"]:
        result = recursive_app.invoke({
            "problem": sub_problem,
            "sub_problems": [],
            "solutions": [],
            "depth": state["depth"] + 1,
            "max_depth": state["max_depth"]
        })
        all_solutions.extend(result["solutions"])

    return {"solutions": state["solutions"] + all_solutions}

recursive_graph = StateGraph(RecursiveState)
recursive_graph.add_node("decompose", decompose_problem)
recursive_graph.add_node("solve", solve_directly)
recursive_graph.add_node("recurse", recurse_subgraph)

recursive_graph.add_edge(START, "decompose")
recursive_graph.add_conditional_edges("decompose", solve_or_recurse, {
    "solve": "solve",
    "recurse": "recurse",
    "end": END
})
recursive_graph.add_edge("solve", END)
recursive_graph.add_edge("recurse", END)

recursive_app = recursive_graph.compile()
```

## 서브그래프 팩토리

설정에 따라 다른 서브그래프 생성:

```python
from dataclasses import dataclass

@dataclass
class AgentConfig:
    model: str
    temperature: float
    tools: list[str]
    max_iterations: int

def create_agent_subgraph(config: AgentConfig) -> StateGraph:
    """설정에 따른 에이전트 서브그래프 생성"""

    llm = ChatOpenAI(
        model=config.model,
        temperature=config.temperature
    )

    tools = load_tools(config.tools)
    llm_with_tools = llm.bind_tools(tools)

    class AgentState(TypedDict):
        messages: Annotated[Sequence[BaseMessage], add_messages]
        iterations: int

    async def agent_node(state: AgentState):
        if state["iterations"] >= config.max_iterations:
            return {"messages": [AIMessage(content="Max iterations reached")]}

        response = await llm_with_tools.ainvoke(state["messages"])
        return {
            "messages": [response],
            "iterations": state["iterations"] + 1
        }

    graph = StateGraph(AgentState)
    graph.add_node("agent", agent_node)
    graph.add_node("tools", ToolNode(tools))

    graph.add_edge(START, "agent")
    graph.add_conditional_edges("agent", should_continue, {
        "tools": "tools",
        "end": END
    })
    graph.add_edge("tools", "agent")

    return graph.compile()

# 다양한 에이전트 생성
fast_agent = create_agent_subgraph(AgentConfig(
    model="gpt-4o-mini",
    temperature=0,
    tools=["search"],
    max_iterations=3
))

creative_agent = create_agent_subgraph(AgentConfig(
    model="gpt-4o",
    temperature=0.9,
    tools=["search", "code_interpreter"],
    max_iterations=10
))
```

## 오류 처리

```python
class SubgraphState(TypedDict):
    input: str
    result: str
    error: str | None

async def safe_subgraph_call(state: SubgraphState) -> dict:
    """에러 핸들링이 포함된 서브그래프 호출"""
    try:
        result = await subgraph.ainvoke({"input": state["input"]})
        return {
            "result": result["output"],
            "error": None
        }
    except Exception as e:
        return {
            "result": "",
            "error": str(e)
        }

def handle_error_or_continue(state: SubgraphState) -> str:
    if state["error"]:
        return "error_handler"
    return "next_step"

graph.add_node("subgraph_call", safe_subgraph_call)
graph.add_node("error_handler", handle_error)
graph.add_node("next_step", continue_processing)

graph.add_conditional_edges("subgraph_call", handle_error_or_continue, {
    "error_handler": "error_handler",
    "next_step": "next_step"
})
```

## 다음 단계

다음 섹션에서는 체크포인팅 고급 기능을 알아봅니다.
