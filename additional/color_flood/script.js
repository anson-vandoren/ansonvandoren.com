const darkerColors = [
    "#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00"
];

let clicks = 0;

function generateRandomBoard() {
    const board = [];
    for (let i = 0; i < 16; i++) {
        const row = [];
        for (let j = 0; j < 16; j++) {
            row.push(Math.floor(Math.random() * darkerColors.length));
        }
        board.push(row);
    }
    return board;
}

function renderBoard(board) {
    const gameBoard = document.getElementById("gameBoard");
    gameBoard.innerHTML = "";

    for (let i = 0; i < 16; i++) {
        for (let j = 0; j < 16; j++) {
            const square = document.createElement("div");
            square.classList.add("square");
            square.style.backgroundColor = darkerColors[board[i][j]];
            square.onclick = () => handleClick(i, j);
            gameBoard.appendChild(square);
        }
    }
}

function floodFill(board, x, y, targetColor, replacementColor, checkAdjacency = false) {
    if (x < 0 || x >= 16 || y < 0 || y >= 16) {
        return false;
    }

    if (board[x][y] !== targetColor) {
        return false;
    }

    if (checkAdjacency) {
        return true;
    }

    board[x][y] = replacementColor;

    floodFill(board, x + 1, y, targetColor, replacementColor);
    floodFill(board, x - 1, y, targetColor, replacementColor);
    floodFill(board, x, y + 1, targetColor, replacementColor);
    floodFill(board, x, y - 1, targetColor, replacementColor);

    return true;
}

function handleClick(x, y) {
    const targetColor = board[0][0];
    const replacementColor = board[x][y];

    if (targetColor === replacementColor) {
        return;
    }

    const isAdjacent = floodFill(board, 0, 0, targetColor, replacementColor, true)
        || floodFill(board, 1, 0, targetColor, replacementColor, true)
        || floodFill(board, 0, 1, targetColor, replacementColor, true);

    if (!isAdjacent) {
        return;
    }

    floodFill(board, 0, 0, targetColor, replacementColor);
    renderBoard(board);
    updateClicks();

    if (isGameOver(board)) {
        alert("You won!");
    }
}

function isGameOver(board) {
    const targetColor = board[0][0];

    for (let i = 0; i < 16; i++) {
        for (let j = 0; j < 16; j++) {
            if (board[i][j] !== targetColor) {
                return false;
            }
        }
    }

    return true;
}

function updateClicks() {
    clicks++;
    document.getElementById("clicksCounter").textContent = clicks;
}

const board = generateRandomBoard();
renderBoard(board);
// Add this function to toggle the 'expanded' class
function toggleRules() {
    const rulesElement = document.getElementById("rules");
    rulesElement.classList.toggle("expanded");
}

// Add this code to the end of your script.js file
document.addEventListener("DOMContentLoaded", function () {
    const rulesHeading = document.querySelector("#rules > h3");
    if (rulesHeading) {
        rulesHeading.addEventListener("click", toggleRules);
    }
});