from typing import Literal

from pydantic import BaseModel, Field

ErrorTypeLiteral = Literal[
    "none",
    "sign",
    "arithmetic",
    "algebra",
    "rule_misuse",
    "concept",
    "domain",
    "notation",
    "incomplete",
    "other",
]

SympyStatusLiteral = Literal[
    "EQUIVALENT",
    "NOT_EQUIVALENT",
    "UNPARSABLE",
    "TIMEOUT",
    "NOT_APPLICABLE",
]


class RubricCriterionIn(BaseModel):
    id: str | None = None
    key: str = Field(min_length=1, max_length=64)
    descriptionEn: str
    descriptionAr: str
    maxPoints: float = Field(gt=0)


class ModelAnswerIn(BaseModel):
    solutionStepsLatex: list[str] = Field(min_length=1)
    finalAnswerLatex: str
    finalAnswerSympy: str | None = None
    commonMistakes: str = ""


class ImagePayloadIn(BaseModel):
    dataBase64: str = Field(min_length=1)
    mimeType: str = "image/jpeg"
    sha256: str = ""


class TranscribeRequest(BaseModel):
    images: list[ImagePayloadIn] = Field(min_length=1, max_length=2)
    questionPromptLatex: str | None = None
    languageHint: str = "en_math"
    hintTag: str | None = None


class GradeEssayRequest(BaseModel):
    questionPromptLatex: str = Field(min_length=1)
    modelAnswer: ModelAnswerIn
    rubricCriteria: list[RubricCriterionIn] = Field(min_length=1)
    images: list[ImagePayloadIn] = Field(min_length=1, max_length=2)
    rubricVersion: int = Field(default=1, ge=1)
    languageHint: str = "ar"
    forceRefresh: bool = False
    hintTag: str | None = None


class TranscribedLine(BaseModel):
    lineNumber: int = Field(ge=1)
    textLatex: str
    confidence: float = Field(ge=0.0, le=1.0)
    hasUnsure: bool = False
    illegible: bool = False
    crossedOut: bool = False


class TranscriptionResult(BaseModel):
    lines: list[TranscribedLine]
    fullTranscriptionLatex: str
    finalAnswerLatex: str | None = None
    overallConfidence: float = Field(ge=0.0, le=1.0)
    illegibleRatio: float = Field(ge=0.0, le=1.0)
    containsUnsureToken: bool = False
    injectionDetected: bool = False
    injectionSignals: list[str] = Field(default_factory=list)
    rawModelOutput: str = ""
    preprocessWarnings: list[str] = Field(default_factory=list)
    provider: str
    modelName: str
    promptVersion: str
    inputTokens: int = 0
    outputTokens: int = 0
    costUsd: float = 0.0
    latencyMs: int = 0


class CriterionScoreOut(BaseModel):
    criterionKey: str
    awardedPoints: float = Field(ge=0.0)
    maxPoints: float = Field(gt=0.0)
    met: bool
    evidenceStep: int | None = None
    commentAr: str = ""


class SympyCheckResult(BaseModel):
    checked: bool
    status: SympyStatusLiteral
    studentFinalSympy: str | None = None
    expectedFinalSympy: str | None = None
    equivalent: bool | None = None
    detail: str = ""


class GradeEssayResponse(BaseModel):
    provider: str
    modelName: str
    promptVersion: str
    rubricVersion: int
    imageHash: str
    transcription: TranscriptionResult
    criteriaScores: list[CriterionScoreOut]
    aiTotal: float = Field(ge=0.0)
    maxPoints: float = Field(gt=0.0)
    finalAnswerCorrect: bool | None = None
    firstErrorStep: int | None = None
    errorType: ErrorTypeLiteral
    errorExplanationAr: str
    hintAr: str
    confidence: float = Field(ge=0.0, le=1.0)
    sympyCheck: SympyCheckResult
    needsReview: bool
    reviewReasons: list[str] = Field(default_factory=list)
    rawOutput: str
    latencyMs: int = 0
    costUsd: float = 0.0
    inputTokens: int = 0
    outputTokens: int = 0
    schemaRetryUsed: bool = False
    cached: bool = False
