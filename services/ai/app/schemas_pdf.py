from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

PdfPageRole = Literal["QUESTIONS", "MODEL_ANSWERS", "MIXED", "COVER_BLANK"]
PdfSympyStatus = Literal["VERIFIED", "MISMATCH", "UNPARSABLE", "NOT_APPLICABLE"]
WarningSeverity = Literal["info", "warning", "error"]


class PdfExtractModelRequest(BaseModel):
    modelNumber: Literal[1, 2]
    title: str = Field(min_length=1, max_length=200)
    durationMinutes: int = Field(default=60, ge=5, le=300)
    pdfBase64: str = Field(min_length=8)


class ReferenceTwinQuestion(BaseModel):
    conceptKey: str = Field(min_length=1, max_length=100)
    promptLatex: str = Field(min_length=1, max_length=10000)
    type: Literal["MCQ", "ESSAY"]


class ExtractExamPdfRequest(BaseModel):
    preModel: PdfExtractModelRequest | None = None
    postModel: PdfExtractModelRequest | None = None
    referenceModel1Questions: list[ReferenceTwinQuestion] = Field(default_factory=list)

    @model_validator(mode="after")
    def require_at_least_one_model(self) -> ExtractExamPdfRequest:
        if self.preModel is None and self.postModel is None:
            raise ValueError("At least one of preModel or postModel must be provided")
        return self


class ExtractedQuestionWarningOut(BaseModel):
    code: str
    severity: WarningSeverity
    messageEn: str
    messageAr: str


class McqOptionOut(BaseModel):
    label: Literal["A", "B", "C", "D"]
    textLatex: str
    isCorrect: bool


class ModelAnswerOut(BaseModel):
    solutionStepsLatex: list[str]
    finalAnswerLatex: str
    finalAnswerSympy: str | None = None
    commonMistakes: str = ""


class RubricCriterionOut(BaseModel):
    orderIndex: int = Field(ge=1)
    key: str
    descriptionEn: str
    descriptionAr: str
    maxPoints: float = Field(gt=0)


class ExtractedQuestionOut(BaseModel):
    tempId: str
    orderIndex: int = Field(ge=1)
    conceptKey: str
    type: Literal["MCQ", "ESSAY"]
    promptLatex: str
    points: float = Field(gt=0)
    solutionUrl: str | None = None
    needsTeacherConfirmation: bool = True
    mcqOptions: list[McqOptionOut] | None = None
    modelAnswer: ModelAnswerOut | None = None
    rubricCriteria: list[RubricCriterionOut] | None = None
    ocrConfidence: float = Field(default=1.0, ge=0.0, le=1.0)
    dualOcrAgreed: bool = True
    sympyStatus: PdfSympyStatus = "NOT_APPLICABLE"
    sympyDetail: str = ""
    sourceQuestionPages: list[int] = Field(default_factory=list)
    sourceAnswerPages: list[int] = Field(default_factory=list)
    warnings: list[ExtractedQuestionWarningOut] = Field(default_factory=list)
    verifiedByTeacher: bool = False


class PdfPageMetaOut(BaseModel):
    pageNumber: int = Field(ge=1)
    role: PdfPageRole
    hasTextLayer: bool
    isBlank: bool


class RenderedPageOut(BaseModel):
    modelNumber: Literal[1, 2]
    pageNumber: int = Field(ge=1)
    imageBase64: str
    mimeType: Literal["image/jpeg"] = "image/jpeg"
    role: PdfPageRole
    hasTextLayer: bool
    isBlank: bool


class ExtractedModelOut(BaseModel):
    modelNumber: Literal[1, 2]
    title: str
    durationMinutes: int
    pageCount: int = Field(ge=1)
    pages: list[PdfPageMetaOut]
    questionsFoundCount: int = Field(ge=0)
    answersFoundCount: int = Field(ge=0)
    matchedCount: int = Field(ge=0)
    unmatchedQuestionNumbers: list[int] = Field(default_factory=list)
    unmatchedAnswerNumbers: list[int] = Field(default_factory=list)
    reportWarnings: list[ExtractedQuestionWarningOut] = Field(default_factory=list)
    questions: list[ExtractedQuestionOut]


class TwinSummaryOut(BaseModel):
    matchedConceptKeys: list[str]
    onlyInModel1: list[str]
    onlyInModel2: list[str]


class PdfExtractionTelemetryOut(BaseModel):
    provider: str
    secondaryProvider: str | None = None
    totalInputTokens: int = Field(ge=0)
    totalOutputTokens: int = Field(ge=0)
    totalCostUsd: float = Field(ge=0.0)
    latencyMs: int = Field(ge=0)


class ExtractExamPdfResponse(BaseModel):
    models: list[ExtractedModelOut]
    renderedPages: list[RenderedPageOut]
    twinSummary: TwinSummaryOut
    telemetry: PdfExtractionTelemetryOut
