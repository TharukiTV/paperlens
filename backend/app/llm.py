"""Provider-agnostic LLM client.

Supports Google Gemini (default, free tier) and any OpenAI-compatible endpoint
(OpenAI, Groq, Ollama, LM Studio, ...). Switch with LLM_PROVIDER in .env.
"""
import json
import logging
import re
import time
from collections.abc import Iterator
from functools import lru_cache

from .config import get_settings

log = logging.getLogger(__name__)

Message = dict  # {"role": "user" | "assistant", "content": str}


class LLMError(RuntimeError):
    """An LLM failure with a message that is safe to show to the user."""


def _friendly_error(exc: Exception, provider: str) -> LLMError:
    code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    text = str(exc)
    if code in (401, 403) or "API key" in text or "API_KEY" in text:
        msg = f"The {provider} API key was rejected. Check the key in backend/.env and restart the server."
    elif code == 429 or "RESOURCE_EXHAUSTED" in text or "rate limit" in text.lower():
        msg = "The model's rate limit was reached. Wait a minute and try again."
    
    elif _timed_out(exc):
        msg = "The model timed out. Wait a minute and try again."
    elif code in (500, 503) or "UNAVAILABLE" in text:
        msg = "The AI model is busy right now (high demand). Wait a minute and try again."
    elif code == 404 or "not found" in text.lower():
        msg = f"The configured {provider} model wasn't found. Check the model name in backend/.env."
    else:
        msg = f"The {provider} request failed: {text[:200]}"
    log.warning("LLM error (%s): %s", provider, text)
    return LLMError(msg)


def _status(exc: Exception):
    return getattr(exc, "code", None) or getattr(exc, "status_code", None)

def _timed_out(exc: Exception) -> bool:
    return "timeout" in type(exc).__name__.lower() or "timed out" in str(exc).lower()


BUSY = {429, 500, 503}   # temporary: wait and retry, then try the next model
MISSING = {404}          # model not available for this key: try the next model


class GeminiLLM:
    name = "Gemini"

    def __init__(self, api_key: str, models: list[str]):
        if not api_key:
            raise LLMError("GEMINI_API_KEY is missing. Add it to backend/.env (free key: https://aistudio.google.com/apikey).")
        from google import genai
        from google.genai import types

        timeout_ms = get_settings().llm_timeout_seconds * 1000
        self.client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=timeout_ms))

        self.models = models          # first = preferred, the rest = fallbacks
        self.last_model = models[0]   # the model that answered most recently

    def _with_fallback(self, call):
        """Run call(model). On busy/unavailable errors, retry once, then move to the next model."""
        last_exc = None
        for model in self.models:
            for attempt in range(2):
                try:
                    result = call(model)
                    if model != self.models[0]:
                        log.info("Answered by fallback model %s", model)
                    self.last_model = model
                    return result
                except Exception as exc:
                    last_exc = exc
                    code = _status(exc)
                    if code in BUSY and attempt == 0:
                        log.warning("%s busy (%s); retrying in 2 s", model, code)
                        time.sleep(2)
                        continue
                    if code in BUSY or code in MISSING:
                        log.warning("%s unavailable (%s); trying next model", model, code)
                        break
                    if _timed_out(exc):
                        log.warning("%s timed out; trying next model", model)
                        break
                    raise _friendly_error(exc, self.name) from exc
        raise _friendly_error(last_exc, self.name) from last_exc

    @staticmethod
    def _contents(messages: list[Message]):
        from google.genai import types

        return [
            types.Content(role="model" if m["role"] == "assistant" else "user",
                          parts=[types.Part(text=m["content"])])
            for m in messages
        ]

    def _config(self, system: str, temperature: float, json_mode: bool):
        from google.genai import types

        return types.GenerateContentConfig(
            system_instruction=system,
            temperature=temperature,
            response_mime_type="application/json" if json_mode else None,
        )

    def complete(self, system: str, messages: list[Message], temperature=0.2, json_mode=False) -> str:
        def call(model):
            resp = self.client.models.generate_content(
                model=model, contents=self._contents(messages),
                config=self._config(system, temperature, json_mode),
            )
            return resp.text or ""

        return self._with_fallback(call)

    def stream(self, system: str, messages: list[Message], temperature=0.2) -> Iterator[str]:
        def open_stream(model):
            chunks = iter(self.client.models.generate_content_stream(
                model=model, contents=self._contents(messages),
                config=self._config(system, temperature, False),
            ))
            # Read the first piece now, so a busy model fails here and the fallback can kick in
            return next(chunks, None), chunks

        first, chunks = self._with_fallback(open_stream)
        try:
            if first is not None and first.text:
                yield first.text
            for chunk in chunks:
                if chunk.text:
                    yield chunk.text
        except Exception as exc:
            raise _friendly_error(exc, self.name) from exc


class OpenAICompatibleLLM:
    name = "OpenAI-compatible"

    def __init__(self, api_key: str, model: str, base_url: str = ""):
        if not api_key:
            raise LLMError("OPENAI_API_KEY is missing. Add it to backend/.env.")
        from openai import OpenAI

        self.client = OpenAI(api_key=api_key, base_url=base_url or None)
        self.model = model

    def complete(self, system: str, messages: list[Message], temperature=0.2, json_mode=False) -> str:
        try:
            resp = self.client.chat.completions.create(
                model=self.model, temperature=temperature,
                messages=[{"role": "system", "content": system}, *messages],
                response_format={"type": "json_object"} if json_mode else None,
            )
            return resp.choices[0].message.content or ""
        except Exception as exc:
            raise _friendly_error(exc, self.name) from exc

    def stream(self, system: str, messages: list[Message], temperature=0.2) -> Iterator[str]:
        try:
            for chunk in self.client.chat.completions.create(
                model=self.model, temperature=temperature, stream=True,
                messages=[{"role": "system", "content": system}, *messages],
            ):
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        except Exception as exc:
            raise _friendly_error(exc, self.name) from exc


@lru_cache
def get_llm():
    s = get_settings()
    if s.llm_provider.lower() == "openai":
        return OpenAICompatibleLLM(s.openai_api_key, s.openai_model, s.openai_base_url)
    models = [s.gemini_model] + [m.strip() for m in s.gemini_fallback_models.split(",") if m.strip()]
    return GeminiLLM(s.gemini_api_key, list(dict.fromkeys(models)))  # dict.fromkeys removes duplicates


def model_label() -> str:
    s = get_settings()
    return s.openai_model if s.llm_provider.lower() == "openai" else s.gemini_model


def parse_json(text: str) -> dict:
    """Parse model JSON output, tolerating ```json fences or chatter around the object."""
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if match:
            return json.loads(match.group(0))
        raise LLMError("The model returned a summary in an unexpected format. Try regenerating it.")