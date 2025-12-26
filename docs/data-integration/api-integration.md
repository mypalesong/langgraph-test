---
sidebar_position: 3
---

# REST API 연동

LangGraph에서 외부 REST API를 연동하여 실시간 데이터를 가져오는 방법을 알아봅니다.

## HTTP 클라이언트 설정

### httpx 사용 (권장)

```bash
pip install httpx
```

```python
import httpx
from typing import TypedDict

# 비동기 클라이언트
async def create_http_client():
    return httpx.AsyncClient(
        timeout=30.0,
        headers={"Content-Type": "application/json"}
    )

# 재사용 가능한 클라이언트
http_client = httpx.AsyncClient(
    timeout=httpx.Timeout(30.0),
    limits=httpx.Limits(max_connections=100)
)
```

## API 호출 노드 구현

### 기본 API 호출

```python
from typing import TypedDict, Annotated, Sequence
from langchain_core.messages import BaseMessage
from langgraph.graph import StateGraph, END, START
from langgraph.graph.message import add_messages

class APIState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]
    api_endpoint: str
    api_response: dict | None
    error: str | None

async def call_api(state: APIState) -> dict:
    """외부 API를 호출하는 노드"""
    endpoint = state["api_endpoint"]

    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(endpoint)
            response.raise_for_status()
            return {
                "api_response": response.json(),
                "error": None
            }
        except httpx.HTTPError as e:
            return {
                "api_response": None,
                "error": str(e)
            }
```

### 인증이 필요한 API

```python
import os

class AuthenticatedAPIState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]
    api_response: dict | None

async def call_authenticated_api(state: AuthenticatedAPIState) -> dict:
    """인증된 API를 호출하는 노드"""
    api_key = os.getenv("EXTERNAL_API_KEY")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    async with httpx.AsyncClient(headers=headers) as client:
        response = await client.get("https://api.example.com/data")
        return {"api_response": response.json()}
```

### POST 요청

```python
async def post_to_api(state: APIState) -> dict:
    """POST 요청을 보내는 노드"""
    payload = state.get("payload", {})

    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://api.example.com/submit",
            json=payload
        )
        return {"api_response": response.json()}
```

## API를 도구로 구현

에이전트가 필요할 때 API를 호출하도록 도구로 구현:

```python
from langchain_core.tools import tool
from pydantic import BaseModel, Field

class WeatherQuery(BaseModel):
    city: str = Field(description="날씨를 조회할 도시 이름")

@tool(args_schema=WeatherQuery)
async def get_weather(city: str) -> str:
    """특정 도시의 현재 날씨를 조회합니다."""
    api_key = os.getenv("WEATHER_API_KEY")

    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"https://api.openweathermap.org/data/2.5/weather",
            params={"q": city, "appid": api_key, "units": "metric", "lang": "kr"}
        )

        if response.status_code == 200:
            data = response.json()
            temp = data["main"]["temp"]
            desc = data["weather"][0]["description"]
            return f"{city}의 현재 날씨: {temp}°C, {desc}"
        else:
            return f"날씨 정보를 가져올 수 없습니다: {response.status_code}"

class NewsQuery(BaseModel):
    topic: str = Field(description="검색할 뉴스 주제")

@tool(args_schema=NewsQuery)
async def search_news(topic: str) -> str:
    """최신 뉴스를 검색합니다."""
    api_key = os.getenv("NEWS_API_KEY")

    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://newsapi.org/v2/everything",
            params={
                "q": topic,
                "apiKey": api_key,
                "pageSize": 5,
                "language": "ko"
            }
        )

        if response.status_code == 200:
            articles = response.json().get("articles", [])
            results = []
            for article in articles[:5]:
                results.append(f"- {article['title']}")
            return "\n".join(results) if results else "관련 뉴스가 없습니다."
        else:
            return "뉴스를 가져올 수 없습니다."
```

## 여러 API 병렬 호출

```python
import asyncio

class MultiAPIState(TypedDict):
    query: str
    weather_data: dict | None
    news_data: list[dict]
    stock_data: dict | None

async def fetch_weather(query: str) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.get(f"https://api.weather.com/{query}")
        return response.json()

async def fetch_news(query: str) -> list[dict]:
    async with httpx.AsyncClient() as client:
        response = await client.get(f"https://api.news.com/search?q={query}")
        return response.json().get("articles", [])

async def fetch_stock(query: str) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.get(f"https://api.stocks.com/{query}")
        return response.json()

async def parallel_api_calls(state: MultiAPIState) -> dict:
    """여러 API를 병렬로 호출하는 노드"""
    query = state["query"]

    # 병렬 실행
    weather_task = fetch_weather(query)
    news_task = fetch_news(query)
    stock_task = fetch_stock(query)

    weather, news, stock = await asyncio.gather(
        weather_task,
        news_task,
        stock_task,
        return_exceptions=True  # 에러가 나도 계속 진행
    )

    return {
        "weather_data": weather if not isinstance(weather, Exception) else None,
        "news_data": news if not isinstance(news, Exception) else [],
        "stock_data": stock if not isinstance(stock, Exception) else None
    }
```

## 재시도 로직

```python
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10)
)
async def call_api_with_retry(url: str) -> dict:
    """재시도 로직이 포함된 API 호출"""
    async with httpx.AsyncClient() as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.json()

async def robust_api_node(state: APIState) -> dict:
    """안정적인 API 호출 노드"""
    try:
        data = await call_api_with_retry(state["api_endpoint"])
        return {"api_response": data, "error": None}
    except Exception as e:
        return {"api_response": None, "error": str(e)}
```

## 캐싱

```python
from functools import lru_cache
import hashlib
import json
from datetime import datetime, timedelta

# 간단한 인메모리 캐시
cache = {}
CACHE_TTL = timedelta(minutes=5)

async def cached_api_call(url: str, params: dict = None) -> dict:
    """캐시된 API 호출"""
    cache_key = hashlib.md5(
        f"{url}:{json.dumps(params or {}, sort_keys=True)}".encode()
    ).hexdigest()

    # 캐시 확인
    if cache_key in cache:
        cached_data, cached_time = cache[cache_key]
        if datetime.now() - cached_time < CACHE_TTL:
            return cached_data

    # API 호출
    async with httpx.AsyncClient() as client:
        response = await client.get(url, params=params)
        data = response.json()

    # 캐시 저장
    cache[cache_key] = (data, datetime.now())
    return data
```

## 전체 예제: 멀티 API 에이전트

```python
from typing import TypedDict, Annotated, Sequence, Literal
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, END, START
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
import httpx
import os

# 도구 정의
@tool
async def get_weather(city: str) -> str:
    """도시의 날씨를 조회합니다."""
    # 실제 API 호출 로직
    return f"{city}: 맑음, 22°C"

@tool
async def get_exchange_rate(currency: str) -> str:
    """환율을 조회합니다."""
    # 실제 API 호출 로직
    return f"1 USD = 1,300 {currency}"

@tool
async def search_places(query: str) -> str:
    """장소를 검색합니다."""
    # 실제 API 호출 로직
    return f"'{query}' 검색 결과: 관련 장소 5개 발견"

tools = [get_weather, get_exchange_rate, search_places]

class TravelAgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]

llm = ChatOpenAI(model="gpt-4o-mini").bind_tools(tools)

async def agent(state: TravelAgentState) -> dict:
    response = await llm.ainvoke(state["messages"])
    return {"messages": [response]}

def should_continue(state: TravelAgentState) -> Literal["tools", "end"]:
    last = state["messages"][-1]
    if hasattr(last, "tool_calls") and last.tool_calls:
        return "tools"
    return "end"

# 그래프 구성
graph = StateGraph(TravelAgentState)
graph.add_node("agent", agent)
graph.add_node("tools", ToolNode(tools))

graph.add_edge(START, "agent")
graph.add_conditional_edges("agent", should_continue, {
    "tools": "tools",
    "end": END
})
graph.add_edge("tools", "agent")

app = graph.compile()

# 실행
async def main():
    result = await app.ainvoke({
        "messages": [HumanMessage(
            content="도쿄 여행을 계획 중인데, 날씨와 환율을 알려줘"
        )]
    })
    print(result["messages"][-1].content)

import asyncio
asyncio.run(main())
```

## 다음 단계

다음 섹션에서는 Vector Store를 연동하여 RAG 시스템을 구축하는 방법을 알아봅니다.
