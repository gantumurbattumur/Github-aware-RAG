"""
Retrieval pipeline: query ChromaDB → rerank → generate explanations.
"""

import asyncio
import logging

import chromadb
from openai import OpenAI

from models import QueryResult, SourceFilter

logger = logging.getLogger(__name__)


async def search(
    query: str,
    source_filter: SourceFilter,
    openai_api_key: str,
    chroma_client: chromadb.ClientAPI,
    n_results: int = 5,
) -> list[QueryResult]:
    """
    Search indexed repos using semantic similarity.

    1. Embed the query text
    2. Query the appropriate ChromaDB collection(s)
    3. Merge and rank results
    4. Generate an explanation for each result
    """
    openai_client = OpenAI(api_key=openai_api_key)

    # Step 1: Embed the query
    query_embedding = await _embed_query(openai_client, query)

    # Step 2: Query collection(s)
    all_results: list[dict] = []

    collections_to_query = []
    if source_filter in (SourceFilter.all, SourceFilter.personal):
        collections_to_query.append("personal_repos")
    if source_filter in (SourceFilter.all, SourceFilter.starred):
        collections_to_query.append("starred_repos")

    for collection_name in collections_to_query:
        try:
            collection = chroma_client.get_collection(name=collection_name)
        except Exception:
            logger.warning(f"Collection {collection_name} not found, skipping")
            continue

        # Check if the collection has any items
        if collection.count() == 0:
            continue

        try:
            results = collection.query(
                query_embeddings=[query_embedding],
                n_results=min(n_results, collection.count()),
                include=["documents", "metadatas", "distances"],
            )
        except Exception as e:
            logger.error(f"Error querying {collection_name}: {e}")
            continue

        # Flatten results (query returns nested lists)
        if results["ids"] and results["ids"][0]:
            for i, doc_id in enumerate(results["ids"][0]):
                metadata = results["metadatas"][0][i] if results["metadatas"] else {}
                document = results["documents"][0][i] if results["documents"] else ""
                distance = results["distances"][0][i] if results["distances"] else 1.0

                # Convert distance to a similarity score (ChromaDB cosine distance: 0 = identical)
                score = max(0, 1.0 - distance)

                all_results.append({
                    "id": doc_id,
                    "document": document,
                    "metadata": metadata,
                    "score": score,
                })

    # Step 3: Sort by score (highest first) and take top n
    all_results.sort(key=lambda x: x["score"], reverse=True)
    top_results = all_results[:n_results]

    if not top_results:
        return []

    # Step 4: Generate explanations
    query_results: list[QueryResult] = []
    for result in top_results:
        metadata = result["metadata"]
        snippet = result["document"]

        # Generate explanation (skip if it takes too long)
        explanation = await _generate_explanation(
            openai_client, query, snippet, metadata.get("file_path", "")
        )

        query_results.append(QueryResult(
            repo=metadata.get("repo_full_name", ""),
            file_path=metadata.get("file_path", ""),
            snippet=snippet,
            explanation=explanation,
            github_url=metadata.get("github_url", ""),
            score=round(result["score"], 4),
            source_type=metadata.get("source_type", ""),
        ))

    return query_results


async def _embed_query(openai_client: OpenAI, query: str) -> list[float]:
    """Embed a single query string."""
    def _do_embed():
        response = openai_client.embeddings.create(
            model="text-embedding-3-small",
            input=[query],
        )
        return response.data[0].embedding

    return await asyncio.to_thread(_do_embed)


async def _generate_explanation(
    openai_client: OpenAI,
    query: str,
    snippet: str,
    file_path: str,
) -> str:
    """Generate a one-sentence explanation of why a code snippet is relevant."""
    def _do_generate():
        try:
            response = openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a code search assistant. Given a user's search query "
                            "and a code snippet, explain in ONE concise sentence (max 30 words) "
                            "why this snippet is relevant to the query. Be specific about "
                            "what the code does."
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"Query: {query}\n\n"
                            f"File: {file_path}\n\n"
                            f"Code:\n```\n{snippet[:1000]}\n```"
                        ),
                    },
                ],
                max_tokens=60,
                temperature=0.3,
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            logger.warning(f"Failed to generate explanation: {e}")
            return ""

    return await asyncio.to_thread(_do_generate)
