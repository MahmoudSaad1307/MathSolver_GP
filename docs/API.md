# MathLens API Reference

Generated from Zod schemas via `npm run docs:openapi`.

```json
{
  "openapi": "3.0.3",
  "info": {
    "title": "MathLens API",
    "version": "1.0.0",
    "description": "REST API for MathLens AI-Graded Handwritten Math Exams with Video Remediation"
  },
  "components": {
    "schemas": {},
    "parameters": {}
  },
  "paths": {
    "/healthz": {
      "get": {
        "tags": ["Operations"],
        "responses": {
          "200": {
            "description": "Liveness probe OK"
          }
        }
      }
    },
    "/readyz": {
      "get": {
        "tags": ["Operations"],
        "responses": {
          "200": {
            "description": "Database & Redis ready"
          },
          "503": {
            "description": "Dependency unavailable"
          }
        }
      }
    },
    "/metrics": {
      "get": {
        "tags": ["Operations"],
        "responses": {
          "200": {
            "description": "Prometheus metrics text exposition"
          }
        }
      }
    },
    "/api/v1/auth/teacher/login": {
      "post": {
        "tags": ["Teacher Auth"],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "email": {
                    "type": "string",
                    "maxLength": 254,
                    "format": "email"
                  },
                  "password": {
                    "type": "string",
                    "minLength": 8,
                    "maxLength": 128
                  }
                },
                "required": ["email", "password"]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Authenticated teacher profile (httpOnly access & refresh cookies set)",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "teacher": {
                      "type": "object",
                      "properties": {
                        "id": {
                          "type": "string",
                          "format": "uuid"
                        },
                        "email": {
                          "type": "string",
                          "format": "email"
                        },
                        "displayName": {
                          "type": "string"
                        },
                        "role": {
                          "type": "string",
                          "enum": ["TEACHER"]
                        }
                      },
                      "required": ["id", "email", "displayName", "role"]
                    }
                  },
                  "required": ["teacher"]
                }
              }
            }
          },
          "401": {
            "description": "Invalid credentials",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "error": {
                      "type": "object",
                      "properties": {
                        "code": {
                          "type": "string",
                          "enum": [
                            "UNAUTHORIZED",
                            "FORBIDDEN",
                            "NOT_FOUND",
                            "VALIDATION_ERROR",
                            "CONFLICT",
                            "RATE_LIMITED",
                            "POSTTEST_LOCKED",
                            "INVALID_CREDENTIALS",
                            "INVALID_COHORT_CODE",
                            "COHORT_CLOSED",
                            "INVALID_RESUME_CODE",
                            "CONSENT_REQUIRED",
                            "EXAM_DEADLINE_EXPIRED",
                            "ALREADY_SUBMITTED",
                            "INVALID_UPLOAD",
                            "IMAGE_LIMIT_EXCEEDED",
                            "IMAGE_REJECTED_QUALITY",
                            "RUBRIC_SUM_MISMATCH",
                            "PUBLISH_CHECKLIST_FAILED",
                            "PDF_INVALID",
                            "PDF_TOO_LARGE",
                            "PDF_TOO_MANY_PAGES",
                            "PDF_EXTRACTION_FAILED",
                            "AI_UNAVAILABLE",
                            "AI_CAP_EXCEEDED",
                            "INTERNAL_ERROR"
                          ]
                        },
                        "message_ar": {
                          "type": "string"
                        },
                        "message_en": {
                          "type": "string"
                        },
                        "details": {
                          "nullable": true
                        }
                      },
                      "required": ["code", "message_ar", "message_en"]
                    }
                  },
                  "required": ["error"]
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/auth/teacher/refresh": {
      "post": {
        "tags": ["Teacher Auth"],
        "responses": {
          "200": {
            "description": "Rotated access & refresh cookies",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "teacher": {
                      "type": "object",
                      "properties": {
                        "id": {
                          "type": "string",
                          "format": "uuid"
                        },
                        "email": {
                          "type": "string",
                          "format": "email"
                        },
                        "displayName": {
                          "type": "string"
                        },
                        "role": {
                          "type": "string",
                          "enum": ["TEACHER"]
                        }
                      },
                      "required": ["id", "email", "displayName", "role"]
                    }
                  },
                  "required": ["teacher"]
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired, or reused refresh token",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "error": {
                      "type": "object",
                      "properties": {
                        "code": {
                          "type": "string",
                          "enum": [
                            "UNAUTHORIZED",
                            "FORBIDDEN",
                            "NOT_FOUND",
                            "VALIDATION_ERROR",
                            "CONFLICT",
                            "RATE_LIMITED",
                            "POSTTEST_LOCKED",
                            "INVALID_CREDENTIALS",
                            "INVALID_COHORT_CODE",
                            "COHORT_CLOSED",
                            "INVALID_RESUME_CODE",
                            "CONSENT_REQUIRED",
                            "EXAM_DEADLINE_EXPIRED",
                            "ALREADY_SUBMITTED",
                            "INVALID_UPLOAD",
                            "IMAGE_LIMIT_EXCEEDED",
                            "IMAGE_REJECTED_QUALITY",
                            "RUBRIC_SUM_MISMATCH",
                            "PUBLISH_CHECKLIST_FAILED",
                            "PDF_INVALID",
                            "PDF_TOO_LARGE",
                            "PDF_TOO_MANY_PAGES",
                            "PDF_EXTRACTION_FAILED",
                            "AI_UNAVAILABLE",
                            "AI_CAP_EXCEEDED",
                            "INTERNAL_ERROR"
                          ]
                        },
                        "message_ar": {
                          "type": "string"
                        },
                        "message_en": {
                          "type": "string"
                        },
                        "details": {
                          "nullable": true
                        }
                      },
                      "required": ["code", "message_ar", "message_en"]
                    }
                  },
                  "required": ["error"]
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/auth/teacher/logout": {
      "post": {
        "tags": ["Teacher Auth"],
        "responses": {
          "200": {
            "description": "Logged out current teacher session",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "ok": {
                      "type": "boolean"
                    }
                  },
                  "required": ["ok"]
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/auth/teacher/logout-all": {
      "post": {
        "tags": ["Teacher Auth"],
        "responses": {
          "200": {
            "description": "All teacher refresh token families revoked",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "ok": {
                      "type": "boolean"
                    }
                  },
                  "required": ["ok"]
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "error": {
                      "type": "object",
                      "properties": {
                        "code": {
                          "type": "string",
                          "enum": [
                            "UNAUTHORIZED",
                            "FORBIDDEN",
                            "NOT_FOUND",
                            "VALIDATION_ERROR",
                            "CONFLICT",
                            "RATE_LIMITED",
                            "POSTTEST_LOCKED",
                            "INVALID_CREDENTIALS",
                            "INVALID_COHORT_CODE",
                            "COHORT_CLOSED",
                            "INVALID_RESUME_CODE",
                            "CONSENT_REQUIRED",
                            "EXAM_DEADLINE_EXPIRED",
                            "ALREADY_SUBMITTED",
                            "INVALID_UPLOAD",
                            "IMAGE_LIMIT_EXCEEDED",
                            "IMAGE_REJECTED_QUALITY",
                            "RUBRIC_SUM_MISMATCH",
                            "PUBLISH_CHECKLIST_FAILED",
                            "PDF_INVALID",
                            "PDF_TOO_LARGE",
                            "PDF_TOO_MANY_PAGES",
                            "PDF_EXTRACTION_FAILED",
                            "AI_UNAVAILABLE",
                            "AI_CAP_EXCEEDED",
                            "INTERNAL_ERROR"
                          ]
                        },
                        "message_ar": {
                          "type": "string"
                        },
                        "message_en": {
                          "type": "string"
                        },
                        "details": {
                          "nullable": true
                        }
                      },
                      "required": ["code", "message_ar", "message_en"]
                    }
                  },
                  "required": ["error"]
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/auth/teacher/me": {
      "get": {
        "tags": ["Teacher Auth"],
        "responses": {
          "200": {
            "description": "Current authenticated teacher profile",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "teacher": {
                      "type": "object",
                      "properties": {
                        "id": {
                          "type": "string",
                          "format": "uuid"
                        },
                        "email": {
                          "type": "string",
                          "format": "email"
                        },
                        "displayName": {
                          "type": "string"
                        },
                        "role": {
                          "type": "string",
                          "enum": ["TEACHER"]
                        }
                      },
                      "required": ["id", "email", "displayName", "role"]
                    }
                  },
                  "required": ["teacher"]
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "error": {
                      "type": "object",
                      "properties": {
                        "code": {
                          "type": "string",
                          "enum": [
                            "UNAUTHORIZED",
                            "FORBIDDEN",
                            "NOT_FOUND",
                            "VALIDATION_ERROR",
                            "CONFLICT",
                            "RATE_LIMITED",
                            "POSTTEST_LOCKED",
                            "INVALID_CREDENTIALS",
                            "INVALID_COHORT_CODE",
                            "COHORT_CLOSED",
                            "INVALID_RESUME_CODE",
                            "CONSENT_REQUIRED",
                            "EXAM_DEADLINE_EXPIRED",
                            "ALREADY_SUBMITTED",
                            "INVALID_UPLOAD",
                            "IMAGE_LIMIT_EXCEEDED",
                            "IMAGE_REJECTED_QUALITY",
                            "RUBRIC_SUM_MISMATCH",
                            "PUBLISH_CHECKLIST_FAILED",
                            "PDF_INVALID",
                            "PDF_TOO_LARGE",
                            "PDF_TOO_MANY_PAGES",
                            "PDF_EXTRACTION_FAILED",
                            "AI_UNAVAILABLE",
                            "AI_CAP_EXCEEDED",
                            "INTERNAL_ERROR"
                          ]
                        },
                        "message_ar": {
                          "type": "string"
                        },
                        "message_en": {
                          "type": "string"
                        },
                        "details": {
                          "nullable": true
                        }
                      },
                      "required": ["code", "message_ar", "message_en"]
                    }
                  },
                  "required": ["error"]
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/topics": {
      "get": {
        "tags": ["Teacher Content"],
        "responses": {
          "200": {
            "description": "List teacher-owned topics"
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "error": {
                      "type": "object",
                      "properties": {
                        "code": {
                          "type": "string",
                          "enum": [
                            "UNAUTHORIZED",
                            "FORBIDDEN",
                            "NOT_FOUND",
                            "VALIDATION_ERROR",
                            "CONFLICT",
                            "RATE_LIMITED",
                            "POSTTEST_LOCKED",
                            "INVALID_CREDENTIALS",
                            "INVALID_COHORT_CODE",
                            "COHORT_CLOSED",
                            "INVALID_RESUME_CODE",
                            "CONSENT_REQUIRED",
                            "EXAM_DEADLINE_EXPIRED",
                            "ALREADY_SUBMITTED",
                            "INVALID_UPLOAD",
                            "IMAGE_LIMIT_EXCEEDED",
                            "IMAGE_REJECTED_QUALITY",
                            "RUBRIC_SUM_MISMATCH",
                            "PUBLISH_CHECKLIST_FAILED",
                            "PDF_INVALID",
                            "PDF_TOO_LARGE",
                            "PDF_TOO_MANY_PAGES",
                            "PDF_EXTRACTION_FAILED",
                            "AI_UNAVAILABLE",
                            "AI_CAP_EXCEEDED",
                            "INTERNAL_ERROR"
                          ]
                        },
                        "message_ar": {
                          "type": "string"
                        },
                        "message_en": {
                          "type": "string"
                        },
                        "details": {
                          "nullable": true
                        }
                      },
                      "required": ["code", "message_ar", "message_en"]
                    }
                  },
                  "required": ["error"]
                }
              }
            }
          }
        }
      },
      "post": {
        "tags": ["Teacher Content"],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "title": {
                    "type": "string",
                    "minLength": 2,
                    "maxLength": 200
                  },
                  "description": {
                    "type": "string",
                    "maxLength": 2000,
                    "default": ""
                  },
                  "correctnessThreshold": {
                    "type": "number",
                    "minimum": 0.1,
                    "maximum": 1,
                    "default": 0.6
                  }
                },
                "required": ["title"]
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Created topic with paired DRAFT Model 1 & Model 2"
          }
        }
      }
    },
    "/api/v1/topics/{id}": {
      "get": {
        "tags": ["Teacher Content"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "responses": {
          "200": {
            "description": "Topic details"
          },
          "404": {
            "description": "Not found",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "error": {
                      "type": "object",
                      "properties": {
                        "code": {
                          "type": "string",
                          "enum": [
                            "UNAUTHORIZED",
                            "FORBIDDEN",
                            "NOT_FOUND",
                            "VALIDATION_ERROR",
                            "CONFLICT",
                            "RATE_LIMITED",
                            "POSTTEST_LOCKED",
                            "INVALID_CREDENTIALS",
                            "INVALID_COHORT_CODE",
                            "COHORT_CLOSED",
                            "INVALID_RESUME_CODE",
                            "CONSENT_REQUIRED",
                            "EXAM_DEADLINE_EXPIRED",
                            "ALREADY_SUBMITTED",
                            "INVALID_UPLOAD",
                            "IMAGE_LIMIT_EXCEEDED",
                            "IMAGE_REJECTED_QUALITY",
                            "RUBRIC_SUM_MISMATCH",
                            "PUBLISH_CHECKLIST_FAILED",
                            "PDF_INVALID",
                            "PDF_TOO_LARGE",
                            "PDF_TOO_MANY_PAGES",
                            "PDF_EXTRACTION_FAILED",
                            "AI_UNAVAILABLE",
                            "AI_CAP_EXCEEDED",
                            "INTERNAL_ERROR"
                          ]
                        },
                        "message_ar": {
                          "type": "string"
                        },
                        "message_en": {
                          "type": "string"
                        },
                        "details": {
                          "nullable": true
                        }
                      },
                      "required": ["code", "message_ar", "message_en"]
                    }
                  },
                  "required": ["error"]
                }
              }
            }
          }
        }
      },
      "patch": {
        "tags": ["Teacher Content"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "title": {
                    "type": "string",
                    "minLength": 2,
                    "maxLength": 200
                  },
                  "description": {
                    "type": "string",
                    "maxLength": 2000,
                    "default": ""
                  },
                  "correctnessThreshold": {
                    "type": "number",
                    "minimum": 0.1,
                    "maximum": 1,
                    "default": 0.6
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Updated topic"
          }
        }
      },
      "delete": {
        "tags": ["Teacher Content"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "responses": {
          "204": {
            "description": "Soft-deleted topic"
          }
        }
      }
    },
    "/api/v1/topics/{id}/exams": {
      "get": {
        "tags": ["Teacher Content"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "responses": {
          "200": {
            "description": "Paired Model 1 & Model 2 plus publish checklist"
          }
        }
      }
    },
    "/api/v1/topics/{id}/export": {
      "get": {
        "tags": ["Teacher Content"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "responses": {
          "200": {
            "description": "Exported JSON exam bundle"
          }
        }
      }
    },
    "/api/v1/exams/import": {
      "post": {
        "tags": ["Teacher Content"],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "dryRun": {
                    "type": "boolean",
                    "default": false
                  },
                  "targetTopicId": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "bundle": {
                    "type": "object",
                    "properties": {
                      "topic": {
                        "type": "object",
                        "properties": {
                          "title": {
                            "type": "string",
                            "minLength": 2
                          },
                          "description": {
                            "type": "string",
                            "default": ""
                          },
                          "correctnessThreshold": {
                            "type": "number",
                            "minimum": 0.1,
                            "maximum": 1,
                            "default": 0.6
                          }
                        },
                        "required": ["title"]
                      },
                      "models": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "properties": {
                            "modelNumber": {
                              "anyOf": [
                                {
                                  "type": "number",
                                  "enum": [1]
                                },
                                {
                                  "type": "number",
                                  "enum": [2]
                                }
                              ]
                            },
                            "title": {
                              "type": "string",
                              "minLength": 2
                            },
                            "durationMinutes": {
                              "type": "integer",
                              "minimum": 5,
                              "default": 60
                            },
                            "status": {
                              "type": "string",
                              "enum": ["DRAFT", "PUBLISHED"],
                              "default": "DRAFT"
                            },
                            "questions": {
                              "type": "array",
                              "items": {
                                "type": "object",
                                "properties": {
                                  "orderIndex": {
                                    "type": "integer",
                                    "minimum": 1
                                  },
                                  "conceptKey": {
                                    "type": "string",
                                    "minLength": 1
                                  },
                                  "type": {
                                    "type": "string",
                                    "enum": ["MCQ", "ESSAY"]
                                  },
                                  "promptLatex": {
                                    "type": "string",
                                    "minLength": 1
                                  },
                                  "points": {
                                    "type": "number",
                                    "minimum": 0,
                                    "exclusiveMinimum": true
                                  },
                                  "solutionUrl": {
                                    "type": "string",
                                    "nullable": true,
                                    "maxLength": 1000
                                  },
                                  "needsTeacherConfirmation": {
                                    "type": "boolean",
                                    "default": false
                                  },
                                  "mcqOptions": {
                                    "type": "array",
                                    "items": {
                                      "type": "object",
                                      "properties": {
                                        "label": {
                                          "type": "string",
                                          "enum": ["A", "B", "C", "D"]
                                        },
                                        "textLatex": {
                                          "type": "string",
                                          "minLength": 1,
                                          "maxLength": 2000
                                        },
                                        "isCorrect": {
                                          "type": "boolean"
                                        }
                                      },
                                      "required": ["label", "textLatex", "isCorrect"]
                                    }
                                  },
                                  "modelAnswer": {
                                    "type": "object",
                                    "properties": {
                                      "solutionStepsLatex": {
                                        "type": "array",
                                        "items": {
                                          "type": "string",
                                          "minLength": 1,
                                          "maxLength": 2000
                                        },
                                        "minItems": 1
                                      },
                                      "finalAnswerLatex": {
                                        "type": "string",
                                        "minLength": 1,
                                        "maxLength": 1000
                                      },
                                      "finalAnswerSympy": {
                                        "type": "string",
                                        "nullable": true,
                                        "maxLength": 500
                                      },
                                      "commonMistakes": {
                                        "type": "string",
                                        "maxLength": 4000,
                                        "default": ""
                                      }
                                    },
                                    "required": ["solutionStepsLatex", "finalAnswerLatex"]
                                  },
                                  "rubricCriteria": {
                                    "type": "array",
                                    "items": {
                                      "type": "object",
                                      "properties": {
                                        "id": {
                                          "type": "string",
                                          "format": "uuid"
                                        },
                                        "orderIndex": {
                                          "type": "integer",
                                          "minimum": 1
                                        },
                                        "key": {
                                          "type": "string",
                                          "minLength": 1,
                                          "maxLength": 100
                                        },
                                        "descriptionEn": {
                                          "type": "string",
                                          "minLength": 1,
                                          "maxLength": 1000
                                        },
                                        "descriptionAr": {
                                          "type": "string",
                                          "minLength": 1,
                                          "maxLength": 1000
                                        },
                                        "maxPoints": {
                                          "type": "number",
                                          "minimum": 0,
                                          "exclusiveMinimum": true,
                                          "maximum": 100
                                        }
                                      },
                                      "required": [
                                        "orderIndex",
                                        "key",
                                        "descriptionEn",
                                        "descriptionAr",
                                        "maxPoints"
                                      ]
                                    }
                                  }
                                },
                                "required": [
                                  "orderIndex",
                                  "conceptKey",
                                  "type",
                                  "promptLatex",
                                  "points"
                                ]
                              },
                              "minItems": 1
                            }
                          },
                          "required": ["modelNumber", "title", "questions"]
                        },
                        "minItems": 2,
                        "maxItems": 2
                      }
                    },
                    "required": ["topic", "models"]
                  }
                },
                "required": ["bundle"]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Dry-run diff or imported topic bundle"
          }
        }
      }
    },
    "/api/v1/exams/{id}": {
      "get": {
        "tags": ["Teacher Content"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "responses": {
          "200": {
            "description": "Exam model with ordered questions"
          }
        }
      },
      "patch": {
        "tags": ["Teacher Content"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "title": {
                    "type": "string",
                    "minLength": 2,
                    "maxLength": 200
                  },
                  "durationMinutes": {
                    "type": "integer",
                    "minimum": 5,
                    "maximum": 300
                  },
                  "status": {
                    "type": "string",
                    "enum": ["DRAFT", "PUBLISHED"]
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Updated exam model metadata"
          }
        }
      }
    },
    "/api/v1/exams/{id}/publish": {
      "post": {
        "tags": ["Teacher Content"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "responses": {
          "200": {
            "description": "Published exam model after passing rubric & twin checklist"
          },
          "400": {
            "description": "Publish checklist failed",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "error": {
                      "type": "object",
                      "properties": {
                        "code": {
                          "type": "string",
                          "enum": [
                            "UNAUTHORIZED",
                            "FORBIDDEN",
                            "NOT_FOUND",
                            "VALIDATION_ERROR",
                            "CONFLICT",
                            "RATE_LIMITED",
                            "POSTTEST_LOCKED",
                            "INVALID_CREDENTIALS",
                            "INVALID_COHORT_CODE",
                            "COHORT_CLOSED",
                            "INVALID_RESUME_CODE",
                            "CONSENT_REQUIRED",
                            "EXAM_DEADLINE_EXPIRED",
                            "ALREADY_SUBMITTED",
                            "INVALID_UPLOAD",
                            "IMAGE_LIMIT_EXCEEDED",
                            "IMAGE_REJECTED_QUALITY",
                            "RUBRIC_SUM_MISMATCH",
                            "PUBLISH_CHECKLIST_FAILED",
                            "PDF_INVALID",
                            "PDF_TOO_LARGE",
                            "PDF_TOO_MANY_PAGES",
                            "PDF_EXTRACTION_FAILED",
                            "AI_UNAVAILABLE",
                            "AI_CAP_EXCEEDED",
                            "INTERNAL_ERROR"
                          ]
                        },
                        "message_ar": {
                          "type": "string"
                        },
                        "message_en": {
                          "type": "string"
                        },
                        "details": {
                          "nullable": true
                        }
                      },
                      "required": ["code", "message_ar", "message_en"]
                    }
                  },
                  "required": ["error"]
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/exams/{id}/unpublish": {
      "post": {
        "tags": ["Teacher Content"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "responses": {
          "200": {
            "description": "Returned exam model to DRAFT status"
          }
        }
      }
    },
    "/api/v1/exams/{id}/questions": {
      "post": {
        "tags": ["Teacher Content"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "orderIndex": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 100
                  },
                  "conceptKey": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 100
                  },
                  "type": {
                    "type": "string",
                    "enum": ["MCQ", "ESSAY"]
                  },
                  "promptLatex": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 5000
                  },
                  "points": {
                    "type": "number",
                    "minimum": 0,
                    "exclusiveMinimum": true,
                    "maximum": 100
                  },
                  "solutionUrl": {
                    "type": "string",
                    "nullable": true,
                    "maxLength": 1000
                  },
                  "needsTeacherConfirmation": {
                    "type": "boolean",
                    "default": false
                  },
                  "twinQuestionId": {
                    "type": "string",
                    "nullable": true,
                    "format": "uuid"
                  },
                  "mcqOptions": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "label": {
                          "type": "string",
                          "enum": ["A", "B", "C", "D"]
                        },
                        "textLatex": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 2000
                        },
                        "isCorrect": {
                          "type": "boolean"
                        }
                      },
                      "required": ["label", "textLatex", "isCorrect"]
                    }
                  },
                  "modelAnswer": {
                    "type": "object",
                    "nullable": true,
                    "properties": {
                      "solutionStepsLatex": {
                        "type": "array",
                        "items": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 2000
                        },
                        "minItems": 1
                      },
                      "finalAnswerLatex": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 1000
                      },
                      "finalAnswerSympy": {
                        "type": "string",
                        "nullable": true,
                        "maxLength": 500
                      },
                      "commonMistakes": {
                        "type": "string",
                        "maxLength": 4000,
                        "default": ""
                      }
                    },
                    "required": ["solutionStepsLatex", "finalAnswerLatex"]
                  },
                  "rubricCriteria": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "id": {
                          "type": "string",
                          "format": "uuid"
                        },
                        "orderIndex": {
                          "type": "integer",
                          "minimum": 1
                        },
                        "key": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 100
                        },
                        "descriptionEn": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 1000
                        },
                        "descriptionAr": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 1000
                        },
                        "maxPoints": {
                          "type": "number",
                          "minimum": 0,
                          "exclusiveMinimum": true,
                          "maximum": 100
                        }
                      },
                      "required": [
                        "orderIndex",
                        "key",
                        "descriptionEn",
                        "descriptionAr",
                        "maxPoints"
                      ]
                    }
                  }
                },
                "required": ["orderIndex", "conceptKey", "type", "promptLatex", "points"]
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Question created"
          }
        }
      }
    },
    "/api/v1/questions/{id}": {
      "patch": {
        "tags": ["Teacher Content"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "orderIndex": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 100
                  },
                  "conceptKey": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 100
                  },
                  "type": {
                    "type": "string",
                    "enum": ["MCQ", "ESSAY"]
                  },
                  "promptLatex": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 5000
                  },
                  "points": {
                    "type": "number",
                    "minimum": 0,
                    "exclusiveMinimum": true,
                    "maximum": 100
                  },
                  "solutionUrl": {
                    "type": "string",
                    "nullable": true,
                    "maxLength": 1000
                  },
                  "needsTeacherConfirmation": {
                    "type": "boolean",
                    "default": false
                  },
                  "twinQuestionId": {
                    "type": "string",
                    "nullable": true,
                    "format": "uuid"
                  },
                  "mcqOptions": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "label": {
                          "type": "string",
                          "enum": ["A", "B", "C", "D"]
                        },
                        "textLatex": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 2000
                        },
                        "isCorrect": {
                          "type": "boolean"
                        }
                      },
                      "required": ["label", "textLatex", "isCorrect"]
                    }
                  },
                  "modelAnswer": {
                    "type": "object",
                    "nullable": true,
                    "properties": {
                      "solutionStepsLatex": {
                        "type": "array",
                        "items": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 2000
                        },
                        "minItems": 1
                      },
                      "finalAnswerLatex": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 1000
                      },
                      "finalAnswerSympy": {
                        "type": "string",
                        "nullable": true,
                        "maxLength": 500
                      },
                      "commonMistakes": {
                        "type": "string",
                        "maxLength": 4000,
                        "default": ""
                      }
                    },
                    "required": ["solutionStepsLatex", "finalAnswerLatex"]
                  },
                  "rubricCriteria": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "id": {
                          "type": "string",
                          "format": "uuid"
                        },
                        "orderIndex": {
                          "type": "integer",
                          "minimum": 1
                        },
                        "key": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 100
                        },
                        "descriptionEn": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 1000
                        },
                        "descriptionAr": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 1000
                        },
                        "maxPoints": {
                          "type": "number",
                          "minimum": 0,
                          "exclusiveMinimum": true,
                          "maximum": 100
                        }
                      },
                      "required": [
                        "orderIndex",
                        "key",
                        "descriptionEn",
                        "descriptionAr",
                        "maxPoints"
                      ]
                    }
                  }
                },
                "required": ["orderIndex", "conceptKey", "type", "promptLatex", "points"]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Question updated"
          }
        }
      },
      "delete": {
        "tags": ["Teacher Content"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "responses": {
          "204": {
            "description": "Soft-deleted question"
          }
        }
      }
    },
    "/api/v1/questions/{id}/confirm": {
      "post": {
        "tags": ["Teacher Content"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "responses": {
          "200": {
            "description": "Confirmed placeholder question for publishing"
          }
        }
      }
    },
    "/api/v1/questions/{id}/rubric": {
      "put": {
        "tags": ["Teacher Content"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "criteria": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "id": {
                          "type": "string",
                          "format": "uuid"
                        },
                        "orderIndex": {
                          "type": "integer",
                          "minimum": 1
                        },
                        "key": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 100
                        },
                        "descriptionEn": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 1000
                        },
                        "descriptionAr": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 1000
                        },
                        "maxPoints": {
                          "type": "number",
                          "minimum": 0,
                          "exclusiveMinimum": true,
                          "maximum": 100
                        }
                      },
                      "required": [
                        "orderIndex",
                        "key",
                        "descriptionEn",
                        "descriptionAr",
                        "maxPoints"
                      ]
                    },
                    "minItems": 1
                  }
                },
                "required": ["criteria"]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Updated rubric criteria and incremented rubricVersion"
          }
        }
      }
    },
    "/api/v1/cohorts": {
      "get": {
        "tags": ["Cohorts"],
        "responses": {
          "200": {
            "description": "List teacher-owned cohorts"
          }
        }
      },
      "post": {
        "tags": ["Cohorts"],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "topicId": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "name": {
                    "type": "string",
                    "minLength": 2,
                    "maxLength": 150
                  },
                  "group": {
                    "type": "string",
                    "enum": ["TREATMENT", "CONTROL"]
                  },
                  "requireVideoBeforePost": {
                    "type": "boolean"
                  },
                  "showProvisionalScore": {
                    "type": "boolean",
                    "default": false
                  },
                  "postTestOpensAt": {
                    "type": "string",
                    "nullable": true,
                    "format": "date-time"
                  }
                },
                "required": ["topicId", "name", "group"]
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Cohort created with unique 6-character joinCode"
          }
        }
      }
    },
    "/api/v1/cohorts/randomize-split": {
      "post": {
        "tags": ["Cohorts"],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "studentNames": {
                    "type": "array",
                    "items": {
                      "type": "string",
                      "minLength": 2,
                      "maxLength": 60
                    },
                    "minItems": 2,
                    "maxItems": 500
                  },
                  "seed": {
                    "type": "integer"
                  }
                },
                "required": ["studentNames"]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Deterministic seeded 50/50 TREATMENT/CONTROL split"
          }
        }
      }
    },
    "/api/v1/cohorts/{id}": {
      "get": {
        "tags": ["Cohorts"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "responses": {
          "200": {
            "description": "Cohort details"
          }
        }
      },
      "patch": {
        "tags": ["Cohorts"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string",
                    "minLength": 2,
                    "maxLength": 150
                  },
                  "group": {
                    "type": "string",
                    "enum": ["TREATMENT", "CONTROL"]
                  },
                  "requireVideoBeforePost": {
                    "type": "boolean"
                  },
                  "showProvisionalScore": {
                    "type": "boolean"
                  },
                  "postTestOpensAt": {
                    "type": "string",
                    "nullable": true,
                    "format": "date-time"
                  },
                  "status": {
                    "type": "string",
                    "enum": ["OPEN", "CLOSED", "ARCHIVED"]
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Updated cohort settings"
          }
        }
      },
      "delete": {
        "tags": ["Cohorts"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "responses": {
          "204": {
            "description": "Soft-deleted cohort"
          }
        }
      }
    },
    "/api/v1/cohorts/{id}/data": {
      "delete": {
        "tags": ["Cohorts"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "responses": {
          "200": {
            "description": "Purged all cohort student answer images & anonymized students"
          }
        }
      }
    },
    "/api/v1/cohorts/{id}/open-posttest": {
      "post": {
        "tags": ["Cohorts"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "responses": {
          "200": {
            "description": "Immediately opened Model 2 post-test for a CONTROL cohort"
          }
        }
      }
    },
    "/api/v1/review-queue": {
      "get": {
        "tags": ["Teacher Review"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": false,
            "name": "topicId",
            "in": "query"
          },
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": false,
            "name": "cohortId",
            "in": "query"
          },
          {
            "schema": {
              "type": "string",
              "enum": [
                "LOW_CONFIDENCE",
                "UNSURE_EVIDENCE_TOKEN",
                "HIGH_ILLEGIBLE_RATIO",
                "EMPTY_SUBMISSION",
                "SCHEMA_RETRY_USED",
                "SYMPY_MISMATCH",
                "TOTAL_MISMATCH",
                "INJECTION_ATTEMPT",
                "STUDENT_REPORTED_MISREAD",
                "AI_SERVICE_FAILED",
                "STEP_CHECK_MISMATCH"
              ]
            },
            "required": false,
            "name": "reason",
            "in": "query"
          },
          {
            "schema": {
              "type": "string",
              "enum": ["true", "false"]
            },
            "required": false,
            "name": "includeResolved",
            "in": "query"
          }
        ],
        "responses": {
          "200": {
            "description": "List essays awaiting or resolved in human review queue"
          }
        }
      }
    },
    "/api/v1/grading-results/{id}/override": {
      "post": {
        "tags": ["Teacher Review"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "criteriaScores": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "criterionId": {
                          "type": "string",
                          "format": "uuid"
                        },
                        "awarded": {
                          "type": "number",
                          "minimum": 0,
                          "maximum": 100
                        },
                        "commentAr": {
                          "type": "string",
                          "maxLength": 1000
                        }
                      },
                      "required": ["criterionId", "awarded"]
                    },
                    "minItems": 1
                  },
                  "finalAnswerCorrect": {
                    "type": "boolean"
                  },
                  "errorType": {
                    "type": "string",
                    "enum": [
                      "none",
                      "sign",
                      "arithmetic",
                      "algebra",
                      "rule_misuse",
                      "concept",
                      "domain",
                      "notation",
                      "incomplete",
                      "other"
                    ]
                  },
                  "errorExplanationAr": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 2000
                  },
                  "note": {
                    "type": "string",
                    "maxLength": 2000
                  }
                },
                "required": ["criteriaScores"]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Clamped teacher override recorded (history preserved)"
          }
        }
      }
    },
    "/api/v1/answers/{id}/manual-grade": {
      "post": {
        "tags": ["Teacher Review"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "criteriaScores": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "criterionId": {
                          "type": "string",
                          "format": "uuid"
                        },
                        "awarded": {
                          "type": "number",
                          "minimum": 0,
                          "maximum": 100
                        },
                        "commentAr": {
                          "type": "string",
                          "maxLength": 1000
                        }
                      },
                      "required": ["criterionId", "awarded"]
                    },
                    "minItems": 1
                  },
                  "finalAnswerCorrect": {
                    "type": "boolean"
                  },
                  "errorType": {
                    "type": "string",
                    "enum": [
                      "none",
                      "sign",
                      "arithmetic",
                      "algebra",
                      "rule_misuse",
                      "concept",
                      "domain",
                      "notation",
                      "incomplete",
                      "other"
                    ]
                  },
                  "errorExplanationAr": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 2000
                  },
                  "note": {
                    "type": "string",
                    "maxLength": 2000
                  }
                },
                "required": ["criteriaScores"]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Manual grade persisted cleanly when AI fallback occurred"
          }
        }
      }
    },
    "/api/v1/answers/{id}/retranscribe": {
      "post": {
        "tags": ["Teacher Review"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "responses": {
          "202": {
            "description": "Enqueued forceRefresh re-transcription & grading job"
          }
        }
      }
    },
    "/api/v1/answer-images/{id}/pin": {
      "patch": {
        "tags": ["Teacher Review"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "pinned": {
                    "type": "boolean"
                  }
                },
                "required": ["pinned"]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Updated pinnedByTeacher retention exemption flag"
          }
        }
      }
    },
    "/api/v1/students": {
      "get": {
        "tags": ["Teacher Review"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": false,
            "name": "cohortId",
            "in": "query"
          },
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": false,
            "name": "topicId",
            "in": "query"
          },
          {
            "schema": {
              "type": "string",
              "maxLength": 100
            },
            "required": false,
            "name": "search",
            "in": "query"
          }
        ],
        "responses": {
          "200": {
            "description": "Student roster filtered to teacher-owned cohorts"
          }
        }
      }
    },
    "/api/v1/students/{id}": {
      "get": {
        "tags": ["Teacher Review"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "responses": {
          "200": {
            "description": "Student detail with attempts, video session & audit trail"
          }
        }
      }
    },
    "/api/v1/students/{id}/unlock-posttest": {
      "post": {
        "tags": ["Teacher Review"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "note": {
                    "type": "string",
                    "maxLength": 500
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Manually unlocked Model 2 for student with audit log"
          }
        }
      }
    },
    "/api/v1/analytics": {
      "get": {
        "tags": ["Analytics"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": false,
            "name": "topicId",
            "in": "query"
          },
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": false,
            "name": "cohortId",
            "in": "query"
          }
        ],
        "responses": {
          "200": {
            "description": "Cohort pre/post analytics, SciPy/statsmodels tests, McNemar & AI reliability"
          }
        }
      }
    },
    "/api/v1/usage": {
      "get": {
        "tags": ["Analytics"],
        "parameters": [
          {
            "schema": {
              "type": "integer",
              "minimum": 1,
              "maximum": 365,
              "default": 30
            },
            "required": false,
            "name": "days",
            "in": "query"
          }
        ],
        "responses": {
          "200": {
            "description": "AI token spend, latency percentiles & daily cap progress"
          }
        }
      }
    },
    "/api/v1/cohorts/{id}/export.csv": {
      "get": {
        "tags": ["Analytics"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "responses": {
          "200": {
            "description": "UTF-8 BOM formula-sanitized CSV cohort export"
          }
        }
      }
    },
    "/api/v1/cohorts/{id}/export.xlsx": {
      "get": {
        "tags": ["Analytics"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "responses": {
          "200": {
            "description": "Multi-sheet Excel workbook (Summary, Students, PerQuestion, VideoEvents, Overrides)"
          }
        }
      }
    },
    "/api/v1/student/join": {
      "post": {
        "tags": ["Student"],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "joinCode": {
                    "type": "string",
                    "pattern": "^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$"
                  },
                  "displayName": {
                    "type": "string",
                    "minLength": 2,
                    "maxLength": 60
                  }
                },
                "required": ["joinCode", "displayName"]
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Joined cohort and issued httpOnly student session cookie + printable resumeCode",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "student": {
                      "type": "object",
                      "properties": {
                        "id": {
                          "type": "string",
                          "format": "uuid"
                        },
                        "displayName": {
                          "type": "string"
                        },
                        "resumeCode": {
                          "type": "string"
                        },
                        "cohortId": {
                          "type": "string",
                          "format": "uuid"
                        },
                        "cohortName": {
                          "type": "string"
                        },
                        "group": {
                          "type": "string",
                          "enum": ["TREATMENT", "CONTROL"]
                        }
                      },
                      "required": [
                        "id",
                        "displayName",
                        "resumeCode",
                        "cohortId",
                        "cohortName",
                        "group"
                      ]
                    }
                  },
                  "required": ["student"]
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/student/resume": {
      "post": {
        "tags": ["Student"],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "resumeCode": {
                    "type": "string",
                    "pattern": "^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$"
                  }
                },
                "required": ["resumeCode"]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Student session restored from resumeCode"
          },
          "429": {
            "description": "Rate limited",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "error": {
                      "type": "object",
                      "properties": {
                        "code": {
                          "type": "string",
                          "enum": [
                            "UNAUTHORIZED",
                            "FORBIDDEN",
                            "NOT_FOUND",
                            "VALIDATION_ERROR",
                            "CONFLICT",
                            "RATE_LIMITED",
                            "POSTTEST_LOCKED",
                            "INVALID_CREDENTIALS",
                            "INVALID_COHORT_CODE",
                            "COHORT_CLOSED",
                            "INVALID_RESUME_CODE",
                            "CONSENT_REQUIRED",
                            "EXAM_DEADLINE_EXPIRED",
                            "ALREADY_SUBMITTED",
                            "INVALID_UPLOAD",
                            "IMAGE_LIMIT_EXCEEDED",
                            "IMAGE_REJECTED_QUALITY",
                            "RUBRIC_SUM_MISMATCH",
                            "PUBLISH_CHECKLIST_FAILED",
                            "PDF_INVALID",
                            "PDF_TOO_LARGE",
                            "PDF_TOO_MANY_PAGES",
                            "PDF_EXTRACTION_FAILED",
                            "AI_UNAVAILABLE",
                            "AI_CAP_EXCEEDED",
                            "INTERNAL_ERROR"
                          ]
                        },
                        "message_ar": {
                          "type": "string"
                        },
                        "message_en": {
                          "type": "string"
                        },
                        "details": {
                          "nullable": true
                        }
                      },
                      "required": ["code", "message_ar", "message_en"]
                    }
                  },
                  "required": ["error"]
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/student/logout": {
      "post": {
        "tags": ["Student"],
        "responses": {
          "200": {
            "description": "Student cookie cleared"
          }
        }
      }
    },
    "/api/v1/student/consent": {
      "post": {
        "tags": ["Student"],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "accepted": {
                    "type": "boolean",
                    "enum": [true]
                  }
                },
                "required": ["accepted"]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Consent timestamp persisted"
          }
        }
      }
    },
    "/api/v1/student/me/state": {
      "get": {
        "tags": ["Student"],
        "responses": {
          "200": {
            "description": "Authoritative student state machine snapshot",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "step": {
                      "type": "string",
                      "enum": [
                        "JOIN",
                        "CONSENT",
                        "PRETEST_IN_PROGRESS",
                        "PRETEST_SUBMITTED",
                        "PRETEST_GRADING",
                        "PRETEST_RESULTS",
                        "REMEDIATION",
                        "POSTTEST_UNLOCKED",
                        "POSTTEST_IN_PROGRESS",
                        "POSTTEST_GRADING",
                        "COMPARISON"
                      ]
                    },
                    "student": {
                      "type": "object",
                      "properties": {
                        "id": {
                          "type": "string",
                          "format": "uuid"
                        },
                        "displayName": {
                          "type": "string"
                        },
                        "cohortId": {
                          "type": "string",
                          "format": "uuid"
                        },
                        "cohortName": {
                          "type": "string"
                        },
                        "group": {
                          "type": "string",
                          "enum": ["TREATMENT", "CONTROL"]
                        },
                        "requireVideoBeforePost": {
                          "type": "boolean"
                        },
                        "consentAcceptedAt": {
                          "type": "string",
                          "nullable": true,
                          "format": "date-time"
                        }
                      },
                      "required": [
                        "id",
                        "displayName",
                        "cohortId",
                        "cohortName",
                        "group",
                        "requireVideoBeforePost",
                        "consentAcceptedAt"
                      ]
                    },
                    "topic": {
                      "type": "object",
                      "properties": {
                        "id": {
                          "type": "string",
                          "format": "uuid"
                        },
                        "title": {
                          "type": "string"
                        }
                      },
                      "required": ["id", "title"]
                    },
                    "preTestAttempt": {
                      "type": "object",
                      "nullable": true,
                      "properties": {
                        "id": {
                          "type": "string",
                          "format": "uuid"
                        },
                        "examModelId": {
                          "type": "string",
                          "format": "uuid"
                        },
                        "status": {
                          "type": "string",
                          "enum": [
                            "IN_PROGRESS",
                            "SUBMITTED",
                            "GRADING",
                            "GRADED",
                            "NEEDS_REVIEW",
                            "FINAL"
                          ]
                        },
                        "deadlineAt": {
                          "type": "string",
                          "format": "date-time"
                        }
                      },
                      "required": ["id", "examModelId", "status", "deadlineAt"]
                    },
                    "postTestAttempt": {
                      "type": "object",
                      "nullable": true,
                      "properties": {
                        "id": {
                          "type": "string",
                          "format": "uuid"
                        },
                        "examModelId": {
                          "type": "string",
                          "format": "uuid"
                        },
                        "status": {
                          "type": "string",
                          "enum": [
                            "IN_PROGRESS",
                            "SUBMITTED",
                            "GRADING",
                            "GRADED",
                            "NEEDS_REVIEW",
                            "FINAL"
                          ]
                        },
                        "deadlineAt": {
                          "type": "string",
                          "format": "date-time"
                        }
                      },
                      "required": ["id", "examModelId", "status", "deadlineAt"]
                    },
                    "postTestLockReason": {
                      "type": "object",
                      "nullable": true,
                      "properties": {
                        "code": {
                          "type": "string"
                        },
                        "message_ar": {
                          "type": "string"
                        },
                        "message_en": {
                          "type": "string"
                        }
                      },
                      "required": ["code", "message_ar", "message_en"]
                    },
                    "videoProgress": {
                      "type": "object",
                      "properties": {
                        "watchedSeconds": {
                          "type": "integer"
                        },
                        "visitedCount": {
                          "type": "integer"
                        },
                        "requiredCount": {
                          "type": "integer"
                        },
                        "unlockedPostAt": {
                          "type": "string",
                          "nullable": true,
                          "format": "date-time"
                        }
                      },
                      "required": [
                        "watchedSeconds",
                        "visitedCount",
                        "requiredCount",
                        "unlockedPostAt"
                      ]
                    }
                  },
                  "required": [
                    "step",
                    "student",
                    "topic",
                    "preTestAttempt",
                    "postTestAttempt",
                    "postTestLockReason",
                    "videoProgress"
                  ]
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/student/data": {
      "delete": {
        "tags": ["Student"],
        "responses": {
          "200": {
            "description": "Student privacy self-erasure completed and cookie cleared"
          }
        }
      }
    },
    "/api/v1/student/attempts": {
      "post": {
        "tags": ["Student"],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "modelNumber": {
                    "anyOf": [
                      {
                        "type": "number",
                        "enum": [1]
                      },
                      {
                        "type": "number",
                        "enum": [2]
                      }
                    ],
                    "default": 1
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Started or resumed attempt (1 or 2)"
          },
          "403": {
            "description": "POSTTEST_LOCKED",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "error": {
                      "type": "object",
                      "properties": {
                        "code": {
                          "type": "string",
                          "enum": [
                            "UNAUTHORIZED",
                            "FORBIDDEN",
                            "NOT_FOUND",
                            "VALIDATION_ERROR",
                            "CONFLICT",
                            "RATE_LIMITED",
                            "POSTTEST_LOCKED",
                            "INVALID_CREDENTIALS",
                            "INVALID_COHORT_CODE",
                            "COHORT_CLOSED",
                            "INVALID_RESUME_CODE",
                            "CONSENT_REQUIRED",
                            "EXAM_DEADLINE_EXPIRED",
                            "ALREADY_SUBMITTED",
                            "INVALID_UPLOAD",
                            "IMAGE_LIMIT_EXCEEDED",
                            "IMAGE_REJECTED_QUALITY",
                            "RUBRIC_SUM_MISMATCH",
                            "PUBLISH_CHECKLIST_FAILED",
                            "PDF_INVALID",
                            "PDF_TOO_LARGE",
                            "PDF_TOO_MANY_PAGES",
                            "PDF_EXTRACTION_FAILED",
                            "AI_UNAVAILABLE",
                            "AI_CAP_EXCEEDED",
                            "INTERNAL_ERROR"
                          ]
                        },
                        "message_ar": {
                          "type": "string"
                        },
                        "message_en": {
                          "type": "string"
                        },
                        "details": {
                          "nullable": true
                        }
                      },
                      "required": ["code", "message_ar", "message_en"]
                    }
                  },
                  "required": ["error"]
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/student/attempts/{id}": {
      "get": {
        "tags": ["Student"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "responses": {
          "200": {
            "description": "Sanitized exam payload (solution keys omitted during active attempt)"
          }
        }
      }
    },
    "/api/v1/student/answers/{id}": {
      "put": {
        "tags": ["Student"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "selectedOptionId": {
                    "type": "string",
                    "nullable": true,
                    "format": "uuid"
                  }
                },
                "required": ["selectedOptionId"]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "MCQ answer autosaved"
          }
        }
      }
    },
    "/api/v1/student/attempts/{attemptId}/answers/{questionId}": {
      "put": {
        "tags": ["Student"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "attemptId",
            "in": "path"
          },
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "questionId",
            "in": "path"
          }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "selectedOptionId": {
                    "type": "string",
                    "nullable": true,
                    "format": "uuid"
                  }
                },
                "required": ["selectedOptionId"]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "MCQ answer autosaved by attempt + question id"
          }
        }
      }
    },
    "/api/v1/student/answers/{id}/images": {
      "post": {
        "tags": ["Student"],
        "responses": {
          "201": {
            "description": "Sanitized handwritten JPEG uploaded to storage & linked cleanly"
          },
          "400": {
            "description": "Invalid image upload",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "error": {
                      "type": "object",
                      "properties": {
                        "code": {
                          "type": "string",
                          "enum": [
                            "UNAUTHORIZED",
                            "FORBIDDEN",
                            "NOT_FOUND",
                            "VALIDATION_ERROR",
                            "CONFLICT",
                            "RATE_LIMITED",
                            "POSTTEST_LOCKED",
                            "INVALID_CREDENTIALS",
                            "INVALID_COHORT_CODE",
                            "COHORT_CLOSED",
                            "INVALID_RESUME_CODE",
                            "CONSENT_REQUIRED",
                            "EXAM_DEADLINE_EXPIRED",
                            "ALREADY_SUBMITTED",
                            "INVALID_UPLOAD",
                            "IMAGE_LIMIT_EXCEEDED",
                            "IMAGE_REJECTED_QUALITY",
                            "RUBRIC_SUM_MISMATCH",
                            "PUBLISH_CHECKLIST_FAILED",
                            "PDF_INVALID",
                            "PDF_TOO_LARGE",
                            "PDF_TOO_MANY_PAGES",
                            "PDF_EXTRACTION_FAILED",
                            "AI_UNAVAILABLE",
                            "AI_CAP_EXCEEDED",
                            "INTERNAL_ERROR"
                          ]
                        },
                        "message_ar": {
                          "type": "string"
                        },
                        "message_en": {
                          "type": "string"
                        },
                        "details": {
                          "nullable": true
                        }
                      },
                      "required": ["code", "message_ar", "message_en"]
                    }
                  },
                  "required": ["error"]
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/student/answer-images/{id}": {
      "delete": {
        "tags": ["Student"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "responses": {
          "204": {
            "description": "Answer image deleted before submit"
          }
        }
      }
    },
    "/api/v1/student/attempts/{id}/submit": {
      "post": {
        "tags": ["Student"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "responses": {
          "200": {
            "description": "Idempotent submission; MCQ graded + essay jobs enqueued"
          }
        }
      }
    },
    "/api/v1/student/attempts/{id}/results": {
      "get": {
        "tags": ["Student"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "responses": {
          "200": {
            "description": "Per-question feedback, video explanation URLs & Arabic error explanations"
          }
        }
      }
    },
    "/api/v1/student/answers/{id}/report-misread": {
      "post": {
        "tags": ["Student"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "note": {
                    "type": "string",
                    "maxLength": 500
                  }
                }
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Flagged AI transcription for teacher review"
          }
        }
      }
    },
    "/api/v1/student/video/state": {
      "get": {
        "tags": ["Student Video"],
        "responses": {
          "200": {
            "description": "Per-question remediation video progress, wrong question list & unlock status"
          }
        }
      }
    },
    "/api/v1/student/video/heartbeat": {
      "post": {
        "tags": ["Student Video"],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "enum": [
                      "PLAY",
                      "PAUSE",
                      "SEEK",
                      "HEARTBEAT",
                      "ENDED",
                      "QUESTION_LINK_CLICK",
                      "PLAYER_ERROR"
                    ]
                  },
                  "position": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 86400
                  },
                  "playbackRate": {
                    "type": "number",
                    "minimum": 0.25,
                    "maximum": 4,
                    "default": 1
                  },
                  "tabVisible": {
                    "type": "boolean",
                    "default": true
                  },
                  "clientTs": {
                    "type": "string",
                    "format": "date-time"
                  },
                  "questionId": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "playerErrorCode": {
                    "type": "integer"
                  }
                },
                "required": ["type", "position", "clientTs"]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Interval-merged watch time update (rejects seek jumps & >1.5x)"
          }
        }
      }
    },
    "/api/v1/student/video/alert": {
      "post": {
        "tags": ["Student Video"],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "errorCode": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 10000
                  }
                },
                "required": ["errorCode"]
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Recorded YouTube player error alert for teacher visibility"
          }
        }
      }
    },
    "/api/v1/student/comparison": {
      "get": {
        "tags": ["Student Video"],
        "responses": {
          "200": {
            "description": "Pre vs Post comparison with Hake normalized gain & concept breakdown"
          }
        }
      }
    },
    "/api/v1/pdf-imports": {
      "post": {
        "tags": ["PDF Import"],
        "requestBody": {
          "content": {
            "multipart/form-data": {
              "schema": {
                "type": "object",
                "properties": {
                  "prePdf": {
                    "type": "string"
                  },
                  "postPdf": {
                    "type": "string"
                  },
                  "topicId": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "preTitle": {
                    "type": "string"
                  },
                  "postTitle": {
                    "type": "string"
                  },
                  "topicMeta": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "responses": {
          "202": {
            "description": "PDF import job queued for background OCR + AI extraction",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "job": {
                      "type": "object",
                      "properties": {
                        "id": {
                          "type": "string",
                          "format": "uuid"
                        },
                        "topicId": {
                          "type": "string",
                          "nullable": true,
                          "format": "uuid"
                        },
                        "appliedTopicId": {
                          "type": "string",
                          "nullable": true,
                          "format": "uuid"
                        },
                        "status": {
                          "type": "string",
                          "enum": ["QUEUED", "PROCESSING", "READY_FOR_REVIEW", "APPLIED", "FAILED"]
                        },
                        "currentStage": {
                          "type": "string"
                        },
                        "progressPct": {
                          "type": "integer",
                          "minimum": 0,
                          "maximum": 100
                        },
                        "hasPrePdf": {
                          "type": "boolean"
                        },
                        "hasPostPdf": {
                          "type": "boolean"
                        },
                        "topicMeta": {
                          "type": "object",
                          "nullable": true,
                          "properties": {
                            "title": {
                              "type": "string",
                              "minLength": 2,
                              "maxLength": 200
                            },
                            "description": {
                              "type": "string",
                              "maxLength": 2000,
                              "default": ""
                            },
                            "correctnessThreshold": {
                              "type": "number",
                              "minimum": 0.1,
                              "maximum": 1,
                              "default": 0.6
                            }
                          },
                          "required": ["title"]
                        },
                        "preview": {
                          "type": "object",
                          "nullable": true,
                          "properties": {
                            "models": {
                              "type": "array",
                              "items": {
                                "type": "object",
                                "properties": {
                                  "modelNumber": {
                                    "anyOf": [
                                      {
                                        "type": "number",
                                        "enum": [1]
                                      },
                                      {
                                        "type": "number",
                                        "enum": [2]
                                      }
                                    ]
                                  },
                                  "title": {
                                    "type": "string",
                                    "minLength": 1,
                                    "maxLength": 200
                                  },
                                  "durationMinutes": {
                                    "type": "integer",
                                    "minimum": 5,
                                    "maximum": 300,
                                    "default": 60
                                  },
                                  "pageCount": {
                                    "type": "integer",
                                    "minimum": 1
                                  },
                                  "pages": {
                                    "type": "array",
                                    "items": {
                                      "type": "object",
                                      "properties": {
                                        "pageNumber": {
                                          "type": "integer",
                                          "minimum": 1
                                        },
                                        "role": {
                                          "type": "string",
                                          "enum": [
                                            "QUESTIONS",
                                            "MODEL_ANSWERS",
                                            "MIXED",
                                            "COVER_BLANK"
                                          ]
                                        },
                                        "hasTextLayer": {
                                          "type": "boolean"
                                        },
                                        "isBlank": {
                                          "type": "boolean"
                                        },
                                        "imageUrl": {
                                          "type": "string"
                                        }
                                      },
                                      "required": ["pageNumber", "role", "hasTextLayer", "isBlank"]
                                    }
                                  },
                                  "questionsFoundCount": {
                                    "type": "integer",
                                    "minimum": 0
                                  },
                                  "answersFoundCount": {
                                    "type": "integer",
                                    "minimum": 0
                                  },
                                  "matchedCount": {
                                    "type": "integer",
                                    "minimum": 0
                                  },
                                  "unmatchedQuestionNumbers": {
                                    "type": "array",
                                    "items": {
                                      "type": "integer"
                                    },
                                    "default": []
                                  },
                                  "unmatchedAnswerNumbers": {
                                    "type": "array",
                                    "items": {
                                      "type": "integer"
                                    },
                                    "default": []
                                  },
                                  "reportWarnings": {
                                    "type": "array",
                                    "items": {
                                      "type": "object",
                                      "properties": {
                                        "code": {
                                          "type": "string",
                                          "enum": [
                                            "OCR_LOW_CONFIDENCE",
                                            "OCR_DISAGREEMENT",
                                            "TEXT_LAYER_DISAGREEMENT",
                                            "SYMPY_UNPARSABLE",
                                            "ANSWER_STEP_MISMATCH",
                                            "MCQ_ANSWER_CONFLICT",
                                            "DUPLICATE_MCQ_OPTIONS",
                                            "UNMATCHED_QUESTION",
                                            "UNMATCHED_ANSWER",
                                            "COUNT_MISMATCH",
                                            "DEFAULT_POINTS_ASSIGNED",
                                            "INVALID_MCQ_OPTIONS",
                                            "ARABIC_LABELS_MAPPED"
                                          ]
                                        },
                                        "severity": {
                                          "type": "string",
                                          "enum": ["info", "warning", "error"]
                                        },
                                        "messageEn": {
                                          "type": "string"
                                        },
                                        "messageAr": {
                                          "type": "string"
                                        }
                                      },
                                      "required": ["code", "severity", "messageEn", "messageAr"]
                                    },
                                    "default": []
                                  },
                                  "questions": {
                                    "type": "array",
                                    "items": {
                                      "type": "object",
                                      "properties": {
                                        "tempId": {
                                          "type": "string",
                                          "minLength": 1,
                                          "maxLength": 100
                                        },
                                        "orderIndex": {
                                          "type": "integer",
                                          "minimum": 1,
                                          "maximum": 200
                                        },
                                        "conceptKey": {
                                          "type": "string",
                                          "minLength": 1,
                                          "maxLength": 100
                                        },
                                        "type": {
                                          "type": "string",
                                          "enum": ["MCQ", "ESSAY"]
                                        },
                                        "promptLatex": {
                                          "type": "string",
                                          "minLength": 1,
                                          "maxLength": 10000
                                        },
                                        "points": {
                                          "type": "number",
                                          "minimum": 0,
                                          "exclusiveMinimum": true,
                                          "maximum": 100
                                        },
                                        "solutionUrl": {
                                          "type": "string",
                                          "nullable": true,
                                          "maxLength": 1000
                                        },
                                        "needsTeacherConfirmation": {
                                          "type": "boolean",
                                          "default": true
                                        },
                                        "mcqOptions": {
                                          "type": "array",
                                          "items": {
                                            "type": "object",
                                            "properties": {
                                              "label": {
                                                "type": "string",
                                                "enum": ["A", "B", "C", "D"]
                                              },
                                              "textLatex": {
                                                "type": "string",
                                                "maxLength": 2000
                                              },
                                              "isCorrect": {
                                                "type": "boolean"
                                              }
                                            },
                                            "required": ["label", "textLatex", "isCorrect"]
                                          }
                                        },
                                        "modelAnswer": {
                                          "type": "object",
                                          "nullable": true,
                                          "properties": {
                                            "solutionStepsLatex": {
                                              "type": "array",
                                              "items": {
                                                "type": "string",
                                                "maxLength": 2000
                                              }
                                            },
                                            "finalAnswerLatex": {
                                              "type": "string",
                                              "maxLength": 1000
                                            },
                                            "finalAnswerSympy": {
                                              "type": "string",
                                              "nullable": true,
                                              "maxLength": 500
                                            },
                                            "commonMistakes": {
                                              "type": "string",
                                              "maxLength": 4000,
                                              "default": ""
                                            }
                                          },
                                          "required": ["solutionStepsLatex", "finalAnswerLatex"]
                                        },
                                        "rubricCriteria": {
                                          "type": "array",
                                          "items": {
                                            "type": "object",
                                            "properties": {
                                              "orderIndex": {
                                                "type": "integer",
                                                "minimum": 1
                                              },
                                              "key": {
                                                "type": "string",
                                                "minLength": 1,
                                                "maxLength": 100
                                              },
                                              "descriptionEn": {
                                                "type": "string",
                                                "minLength": 1,
                                                "maxLength": 1000
                                              },
                                              "descriptionAr": {
                                                "type": "string",
                                                "minLength": 1,
                                                "maxLength": 1000
                                              },
                                              "maxPoints": {
                                                "type": "number",
                                                "minimum": 0,
                                                "exclusiveMinimum": true,
                                                "maximum": 100
                                              }
                                            },
                                            "required": [
                                              "orderIndex",
                                              "key",
                                              "descriptionEn",
                                              "descriptionAr",
                                              "maxPoints"
                                            ]
                                          }
                                        },
                                        "ocrConfidence": {
                                          "type": "number",
                                          "minimum": 0,
                                          "maximum": 1,
                                          "default": 1
                                        },
                                        "dualOcrAgreed": {
                                          "type": "boolean",
                                          "default": true
                                        },
                                        "sympyStatus": {
                                          "type": "string",
                                          "enum": [
                                            "VERIFIED",
                                            "MISMATCH",
                                            "UNPARSABLE",
                                            "NOT_APPLICABLE"
                                          ],
                                          "default": "NOT_APPLICABLE"
                                        },
                                        "sympyDetail": {
                                          "type": "string",
                                          "default": ""
                                        },
                                        "sourceQuestionPages": {
                                          "type": "array",
                                          "items": {
                                            "type": "integer",
                                            "minimum": 1
                                          },
                                          "default": []
                                        },
                                        "sourceAnswerPages": {
                                          "type": "array",
                                          "items": {
                                            "type": "integer",
                                            "minimum": 1
                                          },
                                          "default": []
                                        },
                                        "warnings": {
                                          "type": "array",
                                          "items": {
                                            "type": "object",
                                            "properties": {
                                              "code": {
                                                "type": "string",
                                                "enum": [
                                                  "OCR_LOW_CONFIDENCE",
                                                  "OCR_DISAGREEMENT",
                                                  "TEXT_LAYER_DISAGREEMENT",
                                                  "SYMPY_UNPARSABLE",
                                                  "ANSWER_STEP_MISMATCH",
                                                  "MCQ_ANSWER_CONFLICT",
                                                  "DUPLICATE_MCQ_OPTIONS",
                                                  "UNMATCHED_QUESTION",
                                                  "UNMATCHED_ANSWER",
                                                  "COUNT_MISMATCH",
                                                  "DEFAULT_POINTS_ASSIGNED",
                                                  "INVALID_MCQ_OPTIONS",
                                                  "ARABIC_LABELS_MAPPED"
                                                ]
                                              },
                                              "severity": {
                                                "type": "string",
                                                "enum": ["info", "warning", "error"]
                                              },
                                              "messageEn": {
                                                "type": "string"
                                              },
                                              "messageAr": {
                                                "type": "string"
                                              }
                                            },
                                            "required": [
                                              "code",
                                              "severity",
                                              "messageEn",
                                              "messageAr"
                                            ]
                                          },
                                          "default": []
                                        },
                                        "verifiedByTeacher": {
                                          "type": "boolean",
                                          "default": false
                                        }
                                      },
                                      "required": [
                                        "tempId",
                                        "orderIndex",
                                        "conceptKey",
                                        "type",
                                        "promptLatex",
                                        "points"
                                      ]
                                    }
                                  }
                                },
                                "required": [
                                  "modelNumber",
                                  "title",
                                  "pageCount",
                                  "pages",
                                  "questionsFoundCount",
                                  "answersFoundCount",
                                  "matchedCount",
                                  "questions"
                                ]
                              },
                              "minItems": 1,
                              "maxItems": 2
                            },
                            "twinSummary": {
                              "type": "object",
                              "properties": {
                                "matchedConceptKeys": {
                                  "type": "array",
                                  "items": {
                                    "type": "string"
                                  }
                                },
                                "onlyInModel1": {
                                  "type": "array",
                                  "items": {
                                    "type": "string"
                                  }
                                },
                                "onlyInModel2": {
                                  "type": "array",
                                  "items": {
                                    "type": "string"
                                  }
                                }
                              },
                              "required": ["matchedConceptKeys", "onlyInModel1", "onlyInModel2"]
                            },
                            "telemetry": {
                              "type": "object",
                              "properties": {
                                "provider": {
                                  "type": "string"
                                },
                                "secondaryProvider": {
                                  "type": "string",
                                  "nullable": true,
                                  "default": null
                                },
                                "totalInputTokens": {
                                  "type": "integer",
                                  "minimum": 0
                                },
                                "totalOutputTokens": {
                                  "type": "integer",
                                  "minimum": 0
                                },
                                "totalCostUsd": {
                                  "type": "number",
                                  "minimum": 0
                                },
                                "latencyMs": {
                                  "type": "integer",
                                  "minimum": 0
                                }
                              },
                              "required": [
                                "provider",
                                "totalInputTokens",
                                "totalOutputTokens",
                                "totalCostUsd",
                                "latencyMs"
                              ]
                            }
                          },
                          "required": ["models", "twinSummary", "telemetry"]
                        },
                        "errorCode": {
                          "type": "string",
                          "nullable": true
                        },
                        "errorMessage": {
                          "type": "string",
                          "nullable": true
                        },
                        "createdAt": {
                          "type": "string"
                        },
                        "updatedAt": {
                          "type": "string"
                        },
                        "expiresAt": {
                          "type": "string"
                        }
                      },
                      "required": [
                        "id",
                        "topicId",
                        "appliedTopicId",
                        "status",
                        "currentStage",
                        "progressPct",
                        "hasPrePdf",
                        "hasPostPdf",
                        "topicMeta",
                        "preview",
                        "errorCode",
                        "errorMessage",
                        "createdAt",
                        "updatedAt",
                        "expiresAt"
                      ]
                    }
                  },
                  "required": ["job"]
                }
              }
            }
          }
        }
      },
      "get": {
        "tags": ["PDF Import"],
        "responses": {
          "200": {
            "description": "List recent PDF import jobs for the authenticated teacher",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "jobs": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "id": {
                            "type": "string",
                            "format": "uuid"
                          },
                          "topicId": {
                            "type": "string",
                            "nullable": true,
                            "format": "uuid"
                          },
                          "appliedTopicId": {
                            "type": "string",
                            "nullable": true,
                            "format": "uuid"
                          },
                          "status": {
                            "type": "string",
                            "enum": [
                              "QUEUED",
                              "PROCESSING",
                              "READY_FOR_REVIEW",
                              "APPLIED",
                              "FAILED"
                            ]
                          },
                          "currentStage": {
                            "type": "string"
                          },
                          "progressPct": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 100
                          },
                          "hasPrePdf": {
                            "type": "boolean"
                          },
                          "hasPostPdf": {
                            "type": "boolean"
                          },
                          "topicMeta": {
                            "type": "object",
                            "nullable": true,
                            "properties": {
                              "title": {
                                "type": "string",
                                "minLength": 2,
                                "maxLength": 200
                              },
                              "description": {
                                "type": "string",
                                "maxLength": 2000,
                                "default": ""
                              },
                              "correctnessThreshold": {
                                "type": "number",
                                "minimum": 0.1,
                                "maximum": 1,
                                "default": 0.6
                              }
                            },
                            "required": ["title"]
                          },
                          "preview": {
                            "type": "object",
                            "nullable": true,
                            "properties": {
                              "models": {
                                "type": "array",
                                "items": {
                                  "type": "object",
                                  "properties": {
                                    "modelNumber": {
                                      "anyOf": [
                                        {
                                          "type": "number",
                                          "enum": [1]
                                        },
                                        {
                                          "type": "number",
                                          "enum": [2]
                                        }
                                      ]
                                    },
                                    "title": {
                                      "type": "string",
                                      "minLength": 1,
                                      "maxLength": 200
                                    },
                                    "durationMinutes": {
                                      "type": "integer",
                                      "minimum": 5,
                                      "maximum": 300,
                                      "default": 60
                                    },
                                    "pageCount": {
                                      "type": "integer",
                                      "minimum": 1
                                    },
                                    "pages": {
                                      "type": "array",
                                      "items": {
                                        "type": "object",
                                        "properties": {
                                          "pageNumber": {
                                            "type": "integer",
                                            "minimum": 1
                                          },
                                          "role": {
                                            "type": "string",
                                            "enum": [
                                              "QUESTIONS",
                                              "MODEL_ANSWERS",
                                              "MIXED",
                                              "COVER_BLANK"
                                            ]
                                          },
                                          "hasTextLayer": {
                                            "type": "boolean"
                                          },
                                          "isBlank": {
                                            "type": "boolean"
                                          },
                                          "imageUrl": {
                                            "type": "string"
                                          }
                                        },
                                        "required": [
                                          "pageNumber",
                                          "role",
                                          "hasTextLayer",
                                          "isBlank"
                                        ]
                                      }
                                    },
                                    "questionsFoundCount": {
                                      "type": "integer",
                                      "minimum": 0
                                    },
                                    "answersFoundCount": {
                                      "type": "integer",
                                      "minimum": 0
                                    },
                                    "matchedCount": {
                                      "type": "integer",
                                      "minimum": 0
                                    },
                                    "unmatchedQuestionNumbers": {
                                      "type": "array",
                                      "items": {
                                        "type": "integer"
                                      },
                                      "default": []
                                    },
                                    "unmatchedAnswerNumbers": {
                                      "type": "array",
                                      "items": {
                                        "type": "integer"
                                      },
                                      "default": []
                                    },
                                    "reportWarnings": {
                                      "type": "array",
                                      "items": {
                                        "type": "object",
                                        "properties": {
                                          "code": {
                                            "type": "string",
                                            "enum": [
                                              "OCR_LOW_CONFIDENCE",
                                              "OCR_DISAGREEMENT",
                                              "TEXT_LAYER_DISAGREEMENT",
                                              "SYMPY_UNPARSABLE",
                                              "ANSWER_STEP_MISMATCH",
                                              "MCQ_ANSWER_CONFLICT",
                                              "DUPLICATE_MCQ_OPTIONS",
                                              "UNMATCHED_QUESTION",
                                              "UNMATCHED_ANSWER",
                                              "COUNT_MISMATCH",
                                              "DEFAULT_POINTS_ASSIGNED",
                                              "INVALID_MCQ_OPTIONS",
                                              "ARABIC_LABELS_MAPPED"
                                            ]
                                          },
                                          "severity": {
                                            "type": "string",
                                            "enum": ["info", "warning", "error"]
                                          },
                                          "messageEn": {
                                            "type": "string"
                                          },
                                          "messageAr": {
                                            "type": "string"
                                          }
                                        },
                                        "required": ["code", "severity", "messageEn", "messageAr"]
                                      },
                                      "default": []
                                    },
                                    "questions": {
                                      "type": "array",
                                      "items": {
                                        "type": "object",
                                        "properties": {
                                          "tempId": {
                                            "type": "string",
                                            "minLength": 1,
                                            "maxLength": 100
                                          },
                                          "orderIndex": {
                                            "type": "integer",
                                            "minimum": 1,
                                            "maximum": 200
                                          },
                                          "conceptKey": {
                                            "type": "string",
                                            "minLength": 1,
                                            "maxLength": 100
                                          },
                                          "type": {
                                            "type": "string",
                                            "enum": ["MCQ", "ESSAY"]
                                          },
                                          "promptLatex": {
                                            "type": "string",
                                            "minLength": 1,
                                            "maxLength": 10000
                                          },
                                          "points": {
                                            "type": "number",
                                            "minimum": 0,
                                            "exclusiveMinimum": true,
                                            "maximum": 100
                                          },
                                          "solutionUrl": {
                                            "type": "string",
                                            "nullable": true,
                                            "maxLength": 1000
                                          },
                                          "needsTeacherConfirmation": {
                                            "type": "boolean",
                                            "default": true
                                          },
                                          "mcqOptions": {
                                            "type": "array",
                                            "items": {
                                              "type": "object",
                                              "properties": {
                                                "label": {
                                                  "type": "string",
                                                  "enum": ["A", "B", "C", "D"]
                                                },
                                                "textLatex": {
                                                  "type": "string",
                                                  "maxLength": 2000
                                                },
                                                "isCorrect": {
                                                  "type": "boolean"
                                                }
                                              },
                                              "required": ["label", "textLatex", "isCorrect"]
                                            }
                                          },
                                          "modelAnswer": {
                                            "type": "object",
                                            "nullable": true,
                                            "properties": {
                                              "solutionStepsLatex": {
                                                "type": "array",
                                                "items": {
                                                  "type": "string",
                                                  "maxLength": 2000
                                                }
                                              },
                                              "finalAnswerLatex": {
                                                "type": "string",
                                                "maxLength": 1000
                                              },
                                              "finalAnswerSympy": {
                                                "type": "string",
                                                "nullable": true,
                                                "maxLength": 500
                                              },
                                              "commonMistakes": {
                                                "type": "string",
                                                "maxLength": 4000,
                                                "default": ""
                                              }
                                            },
                                            "required": ["solutionStepsLatex", "finalAnswerLatex"]
                                          },
                                          "rubricCriteria": {
                                            "type": "array",
                                            "items": {
                                              "type": "object",
                                              "properties": {
                                                "orderIndex": {
                                                  "type": "integer",
                                                  "minimum": 1
                                                },
                                                "key": {
                                                  "type": "string",
                                                  "minLength": 1,
                                                  "maxLength": 100
                                                },
                                                "descriptionEn": {
                                                  "type": "string",
                                                  "minLength": 1,
                                                  "maxLength": 1000
                                                },
                                                "descriptionAr": {
                                                  "type": "string",
                                                  "minLength": 1,
                                                  "maxLength": 1000
                                                },
                                                "maxPoints": {
                                                  "type": "number",
                                                  "minimum": 0,
                                                  "exclusiveMinimum": true,
                                                  "maximum": 100
                                                }
                                              },
                                              "required": [
                                                "orderIndex",
                                                "key",
                                                "descriptionEn",
                                                "descriptionAr",
                                                "maxPoints"
                                              ]
                                            }
                                          },
                                          "ocrConfidence": {
                                            "type": "number",
                                            "minimum": 0,
                                            "maximum": 1,
                                            "default": 1
                                          },
                                          "dualOcrAgreed": {
                                            "type": "boolean",
                                            "default": true
                                          },
                                          "sympyStatus": {
                                            "type": "string",
                                            "enum": [
                                              "VERIFIED",
                                              "MISMATCH",
                                              "UNPARSABLE",
                                              "NOT_APPLICABLE"
                                            ],
                                            "default": "NOT_APPLICABLE"
                                          },
                                          "sympyDetail": {
                                            "type": "string",
                                            "default": ""
                                          },
                                          "sourceQuestionPages": {
                                            "type": "array",
                                            "items": {
                                              "type": "integer",
                                              "minimum": 1
                                            },
                                            "default": []
                                          },
                                          "sourceAnswerPages": {
                                            "type": "array",
                                            "items": {
                                              "type": "integer",
                                              "minimum": 1
                                            },
                                            "default": []
                                          },
                                          "warnings": {
                                            "type": "array",
                                            "items": {
                                              "type": "object",
                                              "properties": {
                                                "code": {
                                                  "type": "string",
                                                  "enum": [
                                                    "OCR_LOW_CONFIDENCE",
                                                    "OCR_DISAGREEMENT",
                                                    "TEXT_LAYER_DISAGREEMENT",
                                                    "SYMPY_UNPARSABLE",
                                                    "ANSWER_STEP_MISMATCH",
                                                    "MCQ_ANSWER_CONFLICT",
                                                    "DUPLICATE_MCQ_OPTIONS",
                                                    "UNMATCHED_QUESTION",
                                                    "UNMATCHED_ANSWER",
                                                    "COUNT_MISMATCH",
                                                    "DEFAULT_POINTS_ASSIGNED",
                                                    "INVALID_MCQ_OPTIONS",
                                                    "ARABIC_LABELS_MAPPED"
                                                  ]
                                                },
                                                "severity": {
                                                  "type": "string",
                                                  "enum": ["info", "warning", "error"]
                                                },
                                                "messageEn": {
                                                  "type": "string"
                                                },
                                                "messageAr": {
                                                  "type": "string"
                                                }
                                              },
                                              "required": [
                                                "code",
                                                "severity",
                                                "messageEn",
                                                "messageAr"
                                              ]
                                            },
                                            "default": []
                                          },
                                          "verifiedByTeacher": {
                                            "type": "boolean",
                                            "default": false
                                          }
                                        },
                                        "required": [
                                          "tempId",
                                          "orderIndex",
                                          "conceptKey",
                                          "type",
                                          "promptLatex",
                                          "points"
                                        ]
                                      }
                                    }
                                  },
                                  "required": [
                                    "modelNumber",
                                    "title",
                                    "pageCount",
                                    "pages",
                                    "questionsFoundCount",
                                    "answersFoundCount",
                                    "matchedCount",
                                    "questions"
                                  ]
                                },
                                "minItems": 1,
                                "maxItems": 2
                              },
                              "twinSummary": {
                                "type": "object",
                                "properties": {
                                  "matchedConceptKeys": {
                                    "type": "array",
                                    "items": {
                                      "type": "string"
                                    }
                                  },
                                  "onlyInModel1": {
                                    "type": "array",
                                    "items": {
                                      "type": "string"
                                    }
                                  },
                                  "onlyInModel2": {
                                    "type": "array",
                                    "items": {
                                      "type": "string"
                                    }
                                  }
                                },
                                "required": ["matchedConceptKeys", "onlyInModel1", "onlyInModel2"]
                              },
                              "telemetry": {
                                "type": "object",
                                "properties": {
                                  "provider": {
                                    "type": "string"
                                  },
                                  "secondaryProvider": {
                                    "type": "string",
                                    "nullable": true,
                                    "default": null
                                  },
                                  "totalInputTokens": {
                                    "type": "integer",
                                    "minimum": 0
                                  },
                                  "totalOutputTokens": {
                                    "type": "integer",
                                    "minimum": 0
                                  },
                                  "totalCostUsd": {
                                    "type": "number",
                                    "minimum": 0
                                  },
                                  "latencyMs": {
                                    "type": "integer",
                                    "minimum": 0
                                  }
                                },
                                "required": [
                                  "provider",
                                  "totalInputTokens",
                                  "totalOutputTokens",
                                  "totalCostUsd",
                                  "latencyMs"
                                ]
                              }
                            },
                            "required": ["models", "twinSummary", "telemetry"]
                          },
                          "errorCode": {
                            "type": "string",
                            "nullable": true
                          },
                          "errorMessage": {
                            "type": "string",
                            "nullable": true
                          },
                          "createdAt": {
                            "type": "string"
                          },
                          "updatedAt": {
                            "type": "string"
                          },
                          "expiresAt": {
                            "type": "string"
                          }
                        },
                        "required": [
                          "id",
                          "topicId",
                          "appliedTopicId",
                          "status",
                          "currentStage",
                          "progressPct",
                          "hasPrePdf",
                          "hasPostPdf",
                          "topicMeta",
                          "preview",
                          "errorCode",
                          "errorMessage",
                          "createdAt",
                          "updatedAt",
                          "expiresAt"
                        ]
                      }
                    }
                  },
                  "required": ["jobs"]
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/pdf-imports/{id}": {
      "get": {
        "tags": ["PDF Import"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "responses": {
          "200": {
            "description": "Poll PDF import job status, warnings, and interactive preview payload",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "job": {
                      "type": "object",
                      "properties": {
                        "id": {
                          "type": "string",
                          "format": "uuid"
                        },
                        "topicId": {
                          "type": "string",
                          "nullable": true,
                          "format": "uuid"
                        },
                        "appliedTopicId": {
                          "type": "string",
                          "nullable": true,
                          "format": "uuid"
                        },
                        "status": {
                          "type": "string",
                          "enum": ["QUEUED", "PROCESSING", "READY_FOR_REVIEW", "APPLIED", "FAILED"]
                        },
                        "currentStage": {
                          "type": "string"
                        },
                        "progressPct": {
                          "type": "integer",
                          "minimum": 0,
                          "maximum": 100
                        },
                        "hasPrePdf": {
                          "type": "boolean"
                        },
                        "hasPostPdf": {
                          "type": "boolean"
                        },
                        "topicMeta": {
                          "type": "object",
                          "nullable": true,
                          "properties": {
                            "title": {
                              "type": "string",
                              "minLength": 2,
                              "maxLength": 200
                            },
                            "description": {
                              "type": "string",
                              "maxLength": 2000,
                              "default": ""
                            },
                            "correctnessThreshold": {
                              "type": "number",
                              "minimum": 0.1,
                              "maximum": 1,
                              "default": 0.6
                            }
                          },
                          "required": ["title"]
                        },
                        "preview": {
                          "type": "object",
                          "nullable": true,
                          "properties": {
                            "models": {
                              "type": "array",
                              "items": {
                                "type": "object",
                                "properties": {
                                  "modelNumber": {
                                    "anyOf": [
                                      {
                                        "type": "number",
                                        "enum": [1]
                                      },
                                      {
                                        "type": "number",
                                        "enum": [2]
                                      }
                                    ]
                                  },
                                  "title": {
                                    "type": "string",
                                    "minLength": 1,
                                    "maxLength": 200
                                  },
                                  "durationMinutes": {
                                    "type": "integer",
                                    "minimum": 5,
                                    "maximum": 300,
                                    "default": 60
                                  },
                                  "pageCount": {
                                    "type": "integer",
                                    "minimum": 1
                                  },
                                  "pages": {
                                    "type": "array",
                                    "items": {
                                      "type": "object",
                                      "properties": {
                                        "pageNumber": {
                                          "type": "integer",
                                          "minimum": 1
                                        },
                                        "role": {
                                          "type": "string",
                                          "enum": [
                                            "QUESTIONS",
                                            "MODEL_ANSWERS",
                                            "MIXED",
                                            "COVER_BLANK"
                                          ]
                                        },
                                        "hasTextLayer": {
                                          "type": "boolean"
                                        },
                                        "isBlank": {
                                          "type": "boolean"
                                        },
                                        "imageUrl": {
                                          "type": "string"
                                        }
                                      },
                                      "required": ["pageNumber", "role", "hasTextLayer", "isBlank"]
                                    }
                                  },
                                  "questionsFoundCount": {
                                    "type": "integer",
                                    "minimum": 0
                                  },
                                  "answersFoundCount": {
                                    "type": "integer",
                                    "minimum": 0
                                  },
                                  "matchedCount": {
                                    "type": "integer",
                                    "minimum": 0
                                  },
                                  "unmatchedQuestionNumbers": {
                                    "type": "array",
                                    "items": {
                                      "type": "integer"
                                    },
                                    "default": []
                                  },
                                  "unmatchedAnswerNumbers": {
                                    "type": "array",
                                    "items": {
                                      "type": "integer"
                                    },
                                    "default": []
                                  },
                                  "reportWarnings": {
                                    "type": "array",
                                    "items": {
                                      "type": "object",
                                      "properties": {
                                        "code": {
                                          "type": "string",
                                          "enum": [
                                            "OCR_LOW_CONFIDENCE",
                                            "OCR_DISAGREEMENT",
                                            "TEXT_LAYER_DISAGREEMENT",
                                            "SYMPY_UNPARSABLE",
                                            "ANSWER_STEP_MISMATCH",
                                            "MCQ_ANSWER_CONFLICT",
                                            "DUPLICATE_MCQ_OPTIONS",
                                            "UNMATCHED_QUESTION",
                                            "UNMATCHED_ANSWER",
                                            "COUNT_MISMATCH",
                                            "DEFAULT_POINTS_ASSIGNED",
                                            "INVALID_MCQ_OPTIONS",
                                            "ARABIC_LABELS_MAPPED"
                                          ]
                                        },
                                        "severity": {
                                          "type": "string",
                                          "enum": ["info", "warning", "error"]
                                        },
                                        "messageEn": {
                                          "type": "string"
                                        },
                                        "messageAr": {
                                          "type": "string"
                                        }
                                      },
                                      "required": ["code", "severity", "messageEn", "messageAr"]
                                    },
                                    "default": []
                                  },
                                  "questions": {
                                    "type": "array",
                                    "items": {
                                      "type": "object",
                                      "properties": {
                                        "tempId": {
                                          "type": "string",
                                          "minLength": 1,
                                          "maxLength": 100
                                        },
                                        "orderIndex": {
                                          "type": "integer",
                                          "minimum": 1,
                                          "maximum": 200
                                        },
                                        "conceptKey": {
                                          "type": "string",
                                          "minLength": 1,
                                          "maxLength": 100
                                        },
                                        "type": {
                                          "type": "string",
                                          "enum": ["MCQ", "ESSAY"]
                                        },
                                        "promptLatex": {
                                          "type": "string",
                                          "minLength": 1,
                                          "maxLength": 10000
                                        },
                                        "points": {
                                          "type": "number",
                                          "minimum": 0,
                                          "exclusiveMinimum": true,
                                          "maximum": 100
                                        },
                                        "solutionUrl": {
                                          "type": "string",
                                          "nullable": true,
                                          "maxLength": 1000
                                        },
                                        "needsTeacherConfirmation": {
                                          "type": "boolean",
                                          "default": true
                                        },
                                        "mcqOptions": {
                                          "type": "array",
                                          "items": {
                                            "type": "object",
                                            "properties": {
                                              "label": {
                                                "type": "string",
                                                "enum": ["A", "B", "C", "D"]
                                              },
                                              "textLatex": {
                                                "type": "string",
                                                "maxLength": 2000
                                              },
                                              "isCorrect": {
                                                "type": "boolean"
                                              }
                                            },
                                            "required": ["label", "textLatex", "isCorrect"]
                                          }
                                        },
                                        "modelAnswer": {
                                          "type": "object",
                                          "nullable": true,
                                          "properties": {
                                            "solutionStepsLatex": {
                                              "type": "array",
                                              "items": {
                                                "type": "string",
                                                "maxLength": 2000
                                              }
                                            },
                                            "finalAnswerLatex": {
                                              "type": "string",
                                              "maxLength": 1000
                                            },
                                            "finalAnswerSympy": {
                                              "type": "string",
                                              "nullable": true,
                                              "maxLength": 500
                                            },
                                            "commonMistakes": {
                                              "type": "string",
                                              "maxLength": 4000,
                                              "default": ""
                                            }
                                          },
                                          "required": ["solutionStepsLatex", "finalAnswerLatex"]
                                        },
                                        "rubricCriteria": {
                                          "type": "array",
                                          "items": {
                                            "type": "object",
                                            "properties": {
                                              "orderIndex": {
                                                "type": "integer",
                                                "minimum": 1
                                              },
                                              "key": {
                                                "type": "string",
                                                "minLength": 1,
                                                "maxLength": 100
                                              },
                                              "descriptionEn": {
                                                "type": "string",
                                                "minLength": 1,
                                                "maxLength": 1000
                                              },
                                              "descriptionAr": {
                                                "type": "string",
                                                "minLength": 1,
                                                "maxLength": 1000
                                              },
                                              "maxPoints": {
                                                "type": "number",
                                                "minimum": 0,
                                                "exclusiveMinimum": true,
                                                "maximum": 100
                                              }
                                            },
                                            "required": [
                                              "orderIndex",
                                              "key",
                                              "descriptionEn",
                                              "descriptionAr",
                                              "maxPoints"
                                            ]
                                          }
                                        },
                                        "ocrConfidence": {
                                          "type": "number",
                                          "minimum": 0,
                                          "maximum": 1,
                                          "default": 1
                                        },
                                        "dualOcrAgreed": {
                                          "type": "boolean",
                                          "default": true
                                        },
                                        "sympyStatus": {
                                          "type": "string",
                                          "enum": [
                                            "VERIFIED",
                                            "MISMATCH",
                                            "UNPARSABLE",
                                            "NOT_APPLICABLE"
                                          ],
                                          "default": "NOT_APPLICABLE"
                                        },
                                        "sympyDetail": {
                                          "type": "string",
                                          "default": ""
                                        },
                                        "sourceQuestionPages": {
                                          "type": "array",
                                          "items": {
                                            "type": "integer",
                                            "minimum": 1
                                          },
                                          "default": []
                                        },
                                        "sourceAnswerPages": {
                                          "type": "array",
                                          "items": {
                                            "type": "integer",
                                            "minimum": 1
                                          },
                                          "default": []
                                        },
                                        "warnings": {
                                          "type": "array",
                                          "items": {
                                            "type": "object",
                                            "properties": {
                                              "code": {
                                                "type": "string",
                                                "enum": [
                                                  "OCR_LOW_CONFIDENCE",
                                                  "OCR_DISAGREEMENT",
                                                  "TEXT_LAYER_DISAGREEMENT",
                                                  "SYMPY_UNPARSABLE",
                                                  "ANSWER_STEP_MISMATCH",
                                                  "MCQ_ANSWER_CONFLICT",
                                                  "DUPLICATE_MCQ_OPTIONS",
                                                  "UNMATCHED_QUESTION",
                                                  "UNMATCHED_ANSWER",
                                                  "COUNT_MISMATCH",
                                                  "DEFAULT_POINTS_ASSIGNED",
                                                  "INVALID_MCQ_OPTIONS",
                                                  "ARABIC_LABELS_MAPPED"
                                                ]
                                              },
                                              "severity": {
                                                "type": "string",
                                                "enum": ["info", "warning", "error"]
                                              },
                                              "messageEn": {
                                                "type": "string"
                                              },
                                              "messageAr": {
                                                "type": "string"
                                              }
                                            },
                                            "required": [
                                              "code",
                                              "severity",
                                              "messageEn",
                                              "messageAr"
                                            ]
                                          },
                                          "default": []
                                        },
                                        "verifiedByTeacher": {
                                          "type": "boolean",
                                          "default": false
                                        }
                                      },
                                      "required": [
                                        "tempId",
                                        "orderIndex",
                                        "conceptKey",
                                        "type",
                                        "promptLatex",
                                        "points"
                                      ]
                                    }
                                  }
                                },
                                "required": [
                                  "modelNumber",
                                  "title",
                                  "pageCount",
                                  "pages",
                                  "questionsFoundCount",
                                  "answersFoundCount",
                                  "matchedCount",
                                  "questions"
                                ]
                              },
                              "minItems": 1,
                              "maxItems": 2
                            },
                            "twinSummary": {
                              "type": "object",
                              "properties": {
                                "matchedConceptKeys": {
                                  "type": "array",
                                  "items": {
                                    "type": "string"
                                  }
                                },
                                "onlyInModel1": {
                                  "type": "array",
                                  "items": {
                                    "type": "string"
                                  }
                                },
                                "onlyInModel2": {
                                  "type": "array",
                                  "items": {
                                    "type": "string"
                                  }
                                }
                              },
                              "required": ["matchedConceptKeys", "onlyInModel1", "onlyInModel2"]
                            },
                            "telemetry": {
                              "type": "object",
                              "properties": {
                                "provider": {
                                  "type": "string"
                                },
                                "secondaryProvider": {
                                  "type": "string",
                                  "nullable": true,
                                  "default": null
                                },
                                "totalInputTokens": {
                                  "type": "integer",
                                  "minimum": 0
                                },
                                "totalOutputTokens": {
                                  "type": "integer",
                                  "minimum": 0
                                },
                                "totalCostUsd": {
                                  "type": "number",
                                  "minimum": 0
                                },
                                "latencyMs": {
                                  "type": "integer",
                                  "minimum": 0
                                }
                              },
                              "required": [
                                "provider",
                                "totalInputTokens",
                                "totalOutputTokens",
                                "totalCostUsd",
                                "latencyMs"
                              ]
                            }
                          },
                          "required": ["models", "twinSummary", "telemetry"]
                        },
                        "errorCode": {
                          "type": "string",
                          "nullable": true
                        },
                        "errorMessage": {
                          "type": "string",
                          "nullable": true
                        },
                        "createdAt": {
                          "type": "string"
                        },
                        "updatedAt": {
                          "type": "string"
                        },
                        "expiresAt": {
                          "type": "string"
                        }
                      },
                      "required": [
                        "id",
                        "topicId",
                        "appliedTopicId",
                        "status",
                        "currentStage",
                        "progressPct",
                        "hasPrePdf",
                        "hasPostPdf",
                        "topicMeta",
                        "preview",
                        "errorCode",
                        "errorMessage",
                        "createdAt",
                        "updatedAt",
                        "expiresAt"
                      ]
                    }
                  },
                  "required": ["job"]
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/pdf-imports/{id}/pages/{modelNumber}/{pageNumber}": {
      "get": {
        "tags": ["PDF Import"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          },
          {
            "schema": {
              "type": "string",
              "enum": ["1", "2"]
            },
            "required": true,
            "name": "modelNumber",
            "in": "path"
          },
          {
            "schema": {
              "type": "string"
            },
            "required": true,
            "name": "pageNumber",
            "in": "path"
          }
        ],
        "responses": {
          "200": {
            "description": "Rendered 200-DPI JPEG preview of source PDF page"
          }
        }
      }
    },
    "/api/v1/pdf-imports/{id}/draft": {
      "put": {
        "tags": ["PDF Import"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "topicMeta": {
                    "type": "object",
                    "properties": {
                      "title": {
                        "type": "string",
                        "minLength": 2,
                        "maxLength": 200
                      },
                      "description": {
                        "type": "string",
                        "maxLength": 2000,
                        "default": ""
                      },
                      "correctnessThreshold": {
                        "type": "number",
                        "minimum": 0.1,
                        "maximum": 1,
                        "default": 0.6
                      }
                    },
                    "required": ["title"]
                  },
                  "models": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "modelNumber": {
                          "anyOf": [
                            {
                              "type": "number",
                              "enum": [1]
                            },
                            {
                              "type": "number",
                              "enum": [2]
                            }
                          ]
                        },
                        "title": {
                          "type": "string",
                          "minLength": 2,
                          "maxLength": 200
                        },
                        "durationMinutes": {
                          "type": "integer",
                          "minimum": 5,
                          "maximum": 300,
                          "default": 60
                        },
                        "questions": {
                          "type": "array",
                          "items": {
                            "type": "object",
                            "properties": {
                              "tempId": {
                                "type": "string",
                                "minLength": 1,
                                "maxLength": 100
                              },
                              "orderIndex": {
                                "type": "integer",
                                "minimum": 1,
                                "maximum": 200
                              },
                              "conceptKey": {
                                "type": "string",
                                "minLength": 1,
                                "maxLength": 100
                              },
                              "type": {
                                "type": "string",
                                "enum": ["MCQ", "ESSAY"]
                              },
                              "promptLatex": {
                                "type": "string",
                                "minLength": 1,
                                "maxLength": 10000
                              },
                              "points": {
                                "type": "number",
                                "minimum": 0,
                                "exclusiveMinimum": true,
                                "maximum": 100
                              },
                              "solutionUrl": {
                                "type": "string",
                                "nullable": true,
                                "maxLength": 1000
                              },
                              "needsTeacherConfirmation": {
                                "type": "boolean",
                                "default": true
                              },
                              "mcqOptions": {
                                "type": "array",
                                "items": {
                                  "type": "object",
                                  "properties": {
                                    "label": {
                                      "type": "string",
                                      "enum": ["A", "B", "C", "D"]
                                    },
                                    "textLatex": {
                                      "type": "string",
                                      "maxLength": 2000
                                    },
                                    "isCorrect": {
                                      "type": "boolean"
                                    }
                                  },
                                  "required": ["label", "textLatex", "isCorrect"]
                                }
                              },
                              "modelAnswer": {
                                "type": "object",
                                "nullable": true,
                                "properties": {
                                  "solutionStepsLatex": {
                                    "type": "array",
                                    "items": {
                                      "type": "string",
                                      "maxLength": 2000
                                    }
                                  },
                                  "finalAnswerLatex": {
                                    "type": "string",
                                    "maxLength": 1000
                                  },
                                  "finalAnswerSympy": {
                                    "type": "string",
                                    "nullable": true,
                                    "maxLength": 500
                                  },
                                  "commonMistakes": {
                                    "type": "string",
                                    "maxLength": 4000,
                                    "default": ""
                                  }
                                },
                                "required": ["solutionStepsLatex", "finalAnswerLatex"]
                              },
                              "rubricCriteria": {
                                "type": "array",
                                "items": {
                                  "type": "object",
                                  "properties": {
                                    "orderIndex": {
                                      "type": "integer",
                                      "minimum": 1
                                    },
                                    "key": {
                                      "type": "string",
                                      "minLength": 1,
                                      "maxLength": 100
                                    },
                                    "descriptionEn": {
                                      "type": "string",
                                      "minLength": 1,
                                      "maxLength": 1000
                                    },
                                    "descriptionAr": {
                                      "type": "string",
                                      "minLength": 1,
                                      "maxLength": 1000
                                    },
                                    "maxPoints": {
                                      "type": "number",
                                      "minimum": 0,
                                      "exclusiveMinimum": true,
                                      "maximum": 100
                                    }
                                  },
                                  "required": [
                                    "orderIndex",
                                    "key",
                                    "descriptionEn",
                                    "descriptionAr",
                                    "maxPoints"
                                  ]
                                }
                              },
                              "ocrConfidence": {
                                "type": "number",
                                "minimum": 0,
                                "maximum": 1,
                                "default": 1
                              },
                              "dualOcrAgreed": {
                                "type": "boolean",
                                "default": true
                              },
                              "sympyStatus": {
                                "type": "string",
                                "enum": ["VERIFIED", "MISMATCH", "UNPARSABLE", "NOT_APPLICABLE"],
                                "default": "NOT_APPLICABLE"
                              },
                              "sympyDetail": {
                                "type": "string",
                                "default": ""
                              },
                              "sourceQuestionPages": {
                                "type": "array",
                                "items": {
                                  "type": "integer",
                                  "minimum": 1
                                },
                                "default": []
                              },
                              "sourceAnswerPages": {
                                "type": "array",
                                "items": {
                                  "type": "integer",
                                  "minimum": 1
                                },
                                "default": []
                              },
                              "warnings": {
                                "type": "array",
                                "items": {
                                  "type": "object",
                                  "properties": {
                                    "code": {
                                      "type": "string",
                                      "enum": [
                                        "OCR_LOW_CONFIDENCE",
                                        "OCR_DISAGREEMENT",
                                        "TEXT_LAYER_DISAGREEMENT",
                                        "SYMPY_UNPARSABLE",
                                        "ANSWER_STEP_MISMATCH",
                                        "MCQ_ANSWER_CONFLICT",
                                        "DUPLICATE_MCQ_OPTIONS",
                                        "UNMATCHED_QUESTION",
                                        "UNMATCHED_ANSWER",
                                        "COUNT_MISMATCH",
                                        "DEFAULT_POINTS_ASSIGNED",
                                        "INVALID_MCQ_OPTIONS",
                                        "ARABIC_LABELS_MAPPED"
                                      ]
                                    },
                                    "severity": {
                                      "type": "string",
                                      "enum": ["info", "warning", "error"]
                                    },
                                    "messageEn": {
                                      "type": "string"
                                    },
                                    "messageAr": {
                                      "type": "string"
                                    }
                                  },
                                  "required": ["code", "severity", "messageEn", "messageAr"]
                                },
                                "default": []
                              },
                              "verifiedByTeacher": {
                                "type": "boolean",
                                "default": false
                              }
                            },
                            "required": [
                              "tempId",
                              "orderIndex",
                              "conceptKey",
                              "type",
                              "promptLatex",
                              "points"
                            ]
                          }
                        }
                      },
                      "required": ["modelNumber", "title", "questions"]
                    },
                    "minItems": 1,
                    "maxItems": 2
                  }
                },
                "required": ["models"]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Save teacher edits and verification flags on extracted draft preview",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "job": {
                      "type": "object",
                      "properties": {
                        "id": {
                          "type": "string",
                          "format": "uuid"
                        },
                        "topicId": {
                          "type": "string",
                          "nullable": true,
                          "format": "uuid"
                        },
                        "appliedTopicId": {
                          "type": "string",
                          "nullable": true,
                          "format": "uuid"
                        },
                        "status": {
                          "type": "string",
                          "enum": ["QUEUED", "PROCESSING", "READY_FOR_REVIEW", "APPLIED", "FAILED"]
                        },
                        "currentStage": {
                          "type": "string"
                        },
                        "progressPct": {
                          "type": "integer",
                          "minimum": 0,
                          "maximum": 100
                        },
                        "hasPrePdf": {
                          "type": "boolean"
                        },
                        "hasPostPdf": {
                          "type": "boolean"
                        },
                        "topicMeta": {
                          "type": "object",
                          "nullable": true,
                          "properties": {
                            "title": {
                              "type": "string",
                              "minLength": 2,
                              "maxLength": 200
                            },
                            "description": {
                              "type": "string",
                              "maxLength": 2000,
                              "default": ""
                            },
                            "correctnessThreshold": {
                              "type": "number",
                              "minimum": 0.1,
                              "maximum": 1,
                              "default": 0.6
                            }
                          },
                          "required": ["title"]
                        },
                        "preview": {
                          "type": "object",
                          "nullable": true,
                          "properties": {
                            "models": {
                              "type": "array",
                              "items": {
                                "type": "object",
                                "properties": {
                                  "modelNumber": {
                                    "anyOf": [
                                      {
                                        "type": "number",
                                        "enum": [1]
                                      },
                                      {
                                        "type": "number",
                                        "enum": [2]
                                      }
                                    ]
                                  },
                                  "title": {
                                    "type": "string",
                                    "minLength": 1,
                                    "maxLength": 200
                                  },
                                  "durationMinutes": {
                                    "type": "integer",
                                    "minimum": 5,
                                    "maximum": 300,
                                    "default": 60
                                  },
                                  "pageCount": {
                                    "type": "integer",
                                    "minimum": 1
                                  },
                                  "pages": {
                                    "type": "array",
                                    "items": {
                                      "type": "object",
                                      "properties": {
                                        "pageNumber": {
                                          "type": "integer",
                                          "minimum": 1
                                        },
                                        "role": {
                                          "type": "string",
                                          "enum": [
                                            "QUESTIONS",
                                            "MODEL_ANSWERS",
                                            "MIXED",
                                            "COVER_BLANK"
                                          ]
                                        },
                                        "hasTextLayer": {
                                          "type": "boolean"
                                        },
                                        "isBlank": {
                                          "type": "boolean"
                                        },
                                        "imageUrl": {
                                          "type": "string"
                                        }
                                      },
                                      "required": ["pageNumber", "role", "hasTextLayer", "isBlank"]
                                    }
                                  },
                                  "questionsFoundCount": {
                                    "type": "integer",
                                    "minimum": 0
                                  },
                                  "answersFoundCount": {
                                    "type": "integer",
                                    "minimum": 0
                                  },
                                  "matchedCount": {
                                    "type": "integer",
                                    "minimum": 0
                                  },
                                  "unmatchedQuestionNumbers": {
                                    "type": "array",
                                    "items": {
                                      "type": "integer"
                                    },
                                    "default": []
                                  },
                                  "unmatchedAnswerNumbers": {
                                    "type": "array",
                                    "items": {
                                      "type": "integer"
                                    },
                                    "default": []
                                  },
                                  "reportWarnings": {
                                    "type": "array",
                                    "items": {
                                      "type": "object",
                                      "properties": {
                                        "code": {
                                          "type": "string",
                                          "enum": [
                                            "OCR_LOW_CONFIDENCE",
                                            "OCR_DISAGREEMENT",
                                            "TEXT_LAYER_DISAGREEMENT",
                                            "SYMPY_UNPARSABLE",
                                            "ANSWER_STEP_MISMATCH",
                                            "MCQ_ANSWER_CONFLICT",
                                            "DUPLICATE_MCQ_OPTIONS",
                                            "UNMATCHED_QUESTION",
                                            "UNMATCHED_ANSWER",
                                            "COUNT_MISMATCH",
                                            "DEFAULT_POINTS_ASSIGNED",
                                            "INVALID_MCQ_OPTIONS",
                                            "ARABIC_LABELS_MAPPED"
                                          ]
                                        },
                                        "severity": {
                                          "type": "string",
                                          "enum": ["info", "warning", "error"]
                                        },
                                        "messageEn": {
                                          "type": "string"
                                        },
                                        "messageAr": {
                                          "type": "string"
                                        }
                                      },
                                      "required": ["code", "severity", "messageEn", "messageAr"]
                                    },
                                    "default": []
                                  },
                                  "questions": {
                                    "type": "array",
                                    "items": {
                                      "type": "object",
                                      "properties": {
                                        "tempId": {
                                          "type": "string",
                                          "minLength": 1,
                                          "maxLength": 100
                                        },
                                        "orderIndex": {
                                          "type": "integer",
                                          "minimum": 1,
                                          "maximum": 200
                                        },
                                        "conceptKey": {
                                          "type": "string",
                                          "minLength": 1,
                                          "maxLength": 100
                                        },
                                        "type": {
                                          "type": "string",
                                          "enum": ["MCQ", "ESSAY"]
                                        },
                                        "promptLatex": {
                                          "type": "string",
                                          "minLength": 1,
                                          "maxLength": 10000
                                        },
                                        "points": {
                                          "type": "number",
                                          "minimum": 0,
                                          "exclusiveMinimum": true,
                                          "maximum": 100
                                        },
                                        "solutionUrl": {
                                          "type": "string",
                                          "nullable": true,
                                          "maxLength": 1000
                                        },
                                        "needsTeacherConfirmation": {
                                          "type": "boolean",
                                          "default": true
                                        },
                                        "mcqOptions": {
                                          "type": "array",
                                          "items": {
                                            "type": "object",
                                            "properties": {
                                              "label": {
                                                "type": "string",
                                                "enum": ["A", "B", "C", "D"]
                                              },
                                              "textLatex": {
                                                "type": "string",
                                                "maxLength": 2000
                                              },
                                              "isCorrect": {
                                                "type": "boolean"
                                              }
                                            },
                                            "required": ["label", "textLatex", "isCorrect"]
                                          }
                                        },
                                        "modelAnswer": {
                                          "type": "object",
                                          "nullable": true,
                                          "properties": {
                                            "solutionStepsLatex": {
                                              "type": "array",
                                              "items": {
                                                "type": "string",
                                                "maxLength": 2000
                                              }
                                            },
                                            "finalAnswerLatex": {
                                              "type": "string",
                                              "maxLength": 1000
                                            },
                                            "finalAnswerSympy": {
                                              "type": "string",
                                              "nullable": true,
                                              "maxLength": 500
                                            },
                                            "commonMistakes": {
                                              "type": "string",
                                              "maxLength": 4000,
                                              "default": ""
                                            }
                                          },
                                          "required": ["solutionStepsLatex", "finalAnswerLatex"]
                                        },
                                        "rubricCriteria": {
                                          "type": "array",
                                          "items": {
                                            "type": "object",
                                            "properties": {
                                              "orderIndex": {
                                                "type": "integer",
                                                "minimum": 1
                                              },
                                              "key": {
                                                "type": "string",
                                                "minLength": 1,
                                                "maxLength": 100
                                              },
                                              "descriptionEn": {
                                                "type": "string",
                                                "minLength": 1,
                                                "maxLength": 1000
                                              },
                                              "descriptionAr": {
                                                "type": "string",
                                                "minLength": 1,
                                                "maxLength": 1000
                                              },
                                              "maxPoints": {
                                                "type": "number",
                                                "minimum": 0,
                                                "exclusiveMinimum": true,
                                                "maximum": 100
                                              }
                                            },
                                            "required": [
                                              "orderIndex",
                                              "key",
                                              "descriptionEn",
                                              "descriptionAr",
                                              "maxPoints"
                                            ]
                                          }
                                        },
                                        "ocrConfidence": {
                                          "type": "number",
                                          "minimum": 0,
                                          "maximum": 1,
                                          "default": 1
                                        },
                                        "dualOcrAgreed": {
                                          "type": "boolean",
                                          "default": true
                                        },
                                        "sympyStatus": {
                                          "type": "string",
                                          "enum": [
                                            "VERIFIED",
                                            "MISMATCH",
                                            "UNPARSABLE",
                                            "NOT_APPLICABLE"
                                          ],
                                          "default": "NOT_APPLICABLE"
                                        },
                                        "sympyDetail": {
                                          "type": "string",
                                          "default": ""
                                        },
                                        "sourceQuestionPages": {
                                          "type": "array",
                                          "items": {
                                            "type": "integer",
                                            "minimum": 1
                                          },
                                          "default": []
                                        },
                                        "sourceAnswerPages": {
                                          "type": "array",
                                          "items": {
                                            "type": "integer",
                                            "minimum": 1
                                          },
                                          "default": []
                                        },
                                        "warnings": {
                                          "type": "array",
                                          "items": {
                                            "type": "object",
                                            "properties": {
                                              "code": {
                                                "type": "string",
                                                "enum": [
                                                  "OCR_LOW_CONFIDENCE",
                                                  "OCR_DISAGREEMENT",
                                                  "TEXT_LAYER_DISAGREEMENT",
                                                  "SYMPY_UNPARSABLE",
                                                  "ANSWER_STEP_MISMATCH",
                                                  "MCQ_ANSWER_CONFLICT",
                                                  "DUPLICATE_MCQ_OPTIONS",
                                                  "UNMATCHED_QUESTION",
                                                  "UNMATCHED_ANSWER",
                                                  "COUNT_MISMATCH",
                                                  "DEFAULT_POINTS_ASSIGNED",
                                                  "INVALID_MCQ_OPTIONS",
                                                  "ARABIC_LABELS_MAPPED"
                                                ]
                                              },
                                              "severity": {
                                                "type": "string",
                                                "enum": ["info", "warning", "error"]
                                              },
                                              "messageEn": {
                                                "type": "string"
                                              },
                                              "messageAr": {
                                                "type": "string"
                                              }
                                            },
                                            "required": [
                                              "code",
                                              "severity",
                                              "messageEn",
                                              "messageAr"
                                            ]
                                          },
                                          "default": []
                                        },
                                        "verifiedByTeacher": {
                                          "type": "boolean",
                                          "default": false
                                        }
                                      },
                                      "required": [
                                        "tempId",
                                        "orderIndex",
                                        "conceptKey",
                                        "type",
                                        "promptLatex",
                                        "points"
                                      ]
                                    }
                                  }
                                },
                                "required": [
                                  "modelNumber",
                                  "title",
                                  "pageCount",
                                  "pages",
                                  "questionsFoundCount",
                                  "answersFoundCount",
                                  "matchedCount",
                                  "questions"
                                ]
                              },
                              "minItems": 1,
                              "maxItems": 2
                            },
                            "twinSummary": {
                              "type": "object",
                              "properties": {
                                "matchedConceptKeys": {
                                  "type": "array",
                                  "items": {
                                    "type": "string"
                                  }
                                },
                                "onlyInModel1": {
                                  "type": "array",
                                  "items": {
                                    "type": "string"
                                  }
                                },
                                "onlyInModel2": {
                                  "type": "array",
                                  "items": {
                                    "type": "string"
                                  }
                                }
                              },
                              "required": ["matchedConceptKeys", "onlyInModel1", "onlyInModel2"]
                            },
                            "telemetry": {
                              "type": "object",
                              "properties": {
                                "provider": {
                                  "type": "string"
                                },
                                "secondaryProvider": {
                                  "type": "string",
                                  "nullable": true,
                                  "default": null
                                },
                                "totalInputTokens": {
                                  "type": "integer",
                                  "minimum": 0
                                },
                                "totalOutputTokens": {
                                  "type": "integer",
                                  "minimum": 0
                                },
                                "totalCostUsd": {
                                  "type": "number",
                                  "minimum": 0
                                },
                                "latencyMs": {
                                  "type": "integer",
                                  "minimum": 0
                                }
                              },
                              "required": [
                                "provider",
                                "totalInputTokens",
                                "totalOutputTokens",
                                "totalCostUsd",
                                "latencyMs"
                              ]
                            }
                          },
                          "required": ["models", "twinSummary", "telemetry"]
                        },
                        "errorCode": {
                          "type": "string",
                          "nullable": true
                        },
                        "errorMessage": {
                          "type": "string",
                          "nullable": true
                        },
                        "createdAt": {
                          "type": "string"
                        },
                        "updatedAt": {
                          "type": "string"
                        },
                        "expiresAt": {
                          "type": "string"
                        }
                      },
                      "required": [
                        "id",
                        "topicId",
                        "appliedTopicId",
                        "status",
                        "currentStage",
                        "progressPct",
                        "hasPrePdf",
                        "hasPostPdf",
                        "topicMeta",
                        "preview",
                        "errorCode",
                        "errorMessage",
                        "createdAt",
                        "updatedAt",
                        "expiresAt"
                      ]
                    }
                  },
                  "required": ["job"]
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/pdf-imports/{id}/apply": {
      "post": {
        "tags": ["PDF Import"],
        "parameters": [
          {
            "schema": {
              "type": "string",
              "format": "uuid"
            },
            "required": true,
            "name": "id",
            "in": "path"
          }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "targetTopicId": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "topicMeta": {
                    "type": "object",
                    "properties": {
                      "title": {
                        "type": "string",
                        "minLength": 2,
                        "maxLength": 200
                      },
                      "description": {
                        "type": "string",
                        "maxLength": 2000,
                        "default": ""
                      },
                      "correctnessThreshold": {
                        "type": "number",
                        "minimum": 0.1,
                        "maximum": 1,
                        "default": 0.6
                      }
                    },
                    "required": ["title"]
                  },
                  "confirmAllReviewed": {
                    "type": "boolean",
                    "default": false
                  },
                  "models": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "modelNumber": {
                          "anyOf": [
                            {
                              "type": "number",
                              "enum": [1]
                            },
                            {
                              "type": "number",
                              "enum": [2]
                            }
                          ]
                        },
                        "title": {
                          "type": "string",
                          "minLength": 2,
                          "maxLength": 200
                        },
                        "durationMinutes": {
                          "type": "integer",
                          "minimum": 5,
                          "maximum": 300,
                          "default": 60
                        },
                        "questions": {
                          "type": "array",
                          "items": {
                            "type": "object",
                            "properties": {
                              "tempId": {
                                "type": "string",
                                "minLength": 1,
                                "maxLength": 100
                              },
                              "orderIndex": {
                                "type": "integer",
                                "minimum": 1,
                                "maximum": 200
                              },
                              "conceptKey": {
                                "type": "string",
                                "minLength": 1,
                                "maxLength": 100
                              },
                              "type": {
                                "type": "string",
                                "enum": ["MCQ", "ESSAY"]
                              },
                              "promptLatex": {
                                "type": "string",
                                "minLength": 1,
                                "maxLength": 10000
                              },
                              "points": {
                                "type": "number",
                                "minimum": 0,
                                "exclusiveMinimum": true,
                                "maximum": 100
                              },
                              "solutionUrl": {
                                "type": "string",
                                "nullable": true,
                                "maxLength": 1000
                              },
                              "needsTeacherConfirmation": {
                                "type": "boolean",
                                "default": true
                              },
                              "mcqOptions": {
                                "type": "array",
                                "items": {
                                  "type": "object",
                                  "properties": {
                                    "label": {
                                      "type": "string",
                                      "enum": ["A", "B", "C", "D"]
                                    },
                                    "textLatex": {
                                      "type": "string",
                                      "maxLength": 2000
                                    },
                                    "isCorrect": {
                                      "type": "boolean"
                                    }
                                  },
                                  "required": ["label", "textLatex", "isCorrect"]
                                }
                              },
                              "modelAnswer": {
                                "type": "object",
                                "nullable": true,
                                "properties": {
                                  "solutionStepsLatex": {
                                    "type": "array",
                                    "items": {
                                      "type": "string",
                                      "maxLength": 2000
                                    }
                                  },
                                  "finalAnswerLatex": {
                                    "type": "string",
                                    "maxLength": 1000
                                  },
                                  "finalAnswerSympy": {
                                    "type": "string",
                                    "nullable": true,
                                    "maxLength": 500
                                  },
                                  "commonMistakes": {
                                    "type": "string",
                                    "maxLength": 4000,
                                    "default": ""
                                  }
                                },
                                "required": ["solutionStepsLatex", "finalAnswerLatex"]
                              },
                              "rubricCriteria": {
                                "type": "array",
                                "items": {
                                  "type": "object",
                                  "properties": {
                                    "orderIndex": {
                                      "type": "integer",
                                      "minimum": 1
                                    },
                                    "key": {
                                      "type": "string",
                                      "minLength": 1,
                                      "maxLength": 100
                                    },
                                    "descriptionEn": {
                                      "type": "string",
                                      "minLength": 1,
                                      "maxLength": 1000
                                    },
                                    "descriptionAr": {
                                      "type": "string",
                                      "minLength": 1,
                                      "maxLength": 1000
                                    },
                                    "maxPoints": {
                                      "type": "number",
                                      "minimum": 0,
                                      "exclusiveMinimum": true,
                                      "maximum": 100
                                    }
                                  },
                                  "required": [
                                    "orderIndex",
                                    "key",
                                    "descriptionEn",
                                    "descriptionAr",
                                    "maxPoints"
                                  ]
                                }
                              },
                              "ocrConfidence": {
                                "type": "number",
                                "minimum": 0,
                                "maximum": 1,
                                "default": 1
                              },
                              "dualOcrAgreed": {
                                "type": "boolean",
                                "default": true
                              },
                              "sympyStatus": {
                                "type": "string",
                                "enum": ["VERIFIED", "MISMATCH", "UNPARSABLE", "NOT_APPLICABLE"],
                                "default": "NOT_APPLICABLE"
                              },
                              "sympyDetail": {
                                "type": "string",
                                "default": ""
                              },
                              "sourceQuestionPages": {
                                "type": "array",
                                "items": {
                                  "type": "integer",
                                  "minimum": 1
                                },
                                "default": []
                              },
                              "sourceAnswerPages": {
                                "type": "array",
                                "items": {
                                  "type": "integer",
                                  "minimum": 1
                                },
                                "default": []
                              },
                              "warnings": {
                                "type": "array",
                                "items": {
                                  "type": "object",
                                  "properties": {
                                    "code": {
                                      "type": "string",
                                      "enum": [
                                        "OCR_LOW_CONFIDENCE",
                                        "OCR_DISAGREEMENT",
                                        "TEXT_LAYER_DISAGREEMENT",
                                        "SYMPY_UNPARSABLE",
                                        "ANSWER_STEP_MISMATCH",
                                        "MCQ_ANSWER_CONFLICT",
                                        "DUPLICATE_MCQ_OPTIONS",
                                        "UNMATCHED_QUESTION",
                                        "UNMATCHED_ANSWER",
                                        "COUNT_MISMATCH",
                                        "DEFAULT_POINTS_ASSIGNED",
                                        "INVALID_MCQ_OPTIONS",
                                        "ARABIC_LABELS_MAPPED"
                                      ]
                                    },
                                    "severity": {
                                      "type": "string",
                                      "enum": ["info", "warning", "error"]
                                    },
                                    "messageEn": {
                                      "type": "string"
                                    },
                                    "messageAr": {
                                      "type": "string"
                                    }
                                  },
                                  "required": ["code", "severity", "messageEn", "messageAr"]
                                },
                                "default": []
                              },
                              "verifiedByTeacher": {
                                "type": "boolean",
                                "default": false
                              }
                            },
                            "required": [
                              "tempId",
                              "orderIndex",
                              "conceptKey",
                              "type",
                              "promptLatex",
                              "points"
                            ]
                          }
                        }
                      },
                      "required": ["modelNumber", "title", "questions"]
                    },
                    "minItems": 1,
                    "maxItems": 2
                  }
                },
                "required": ["models"]
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Persist verified extracted exams into Topic and ExamModels atomically"
          }
        }
      }
    }
  }
}
```
