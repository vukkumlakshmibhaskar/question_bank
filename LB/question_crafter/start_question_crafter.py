import os

import uvicorn


if __name__ == "__main__":
    uvicorn.run(
        "question_crafter.textbook_question_api:app",
        host=os.getenv("HOST_IP", "0.0.0.0"),
        port=int(os.getenv("PORT", "8090")),
        reload=False,
    )
