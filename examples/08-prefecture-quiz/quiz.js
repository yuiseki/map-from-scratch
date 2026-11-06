export function shuffledIndices(length, random = Math.random) {
    const order = Array.from({
        length
    }, (_, i)=>i);
    for(let i = order.length - 1; i > 0; i--){
        const j = Math.floor(random() * (i + 1));
        [order[i], order[j]] = [
            order[j],
            order[i]
        ];
    }
    return order;
}
export function answerQuiz(order, state, picked) {
    if (state.current >= order.length) return {
        state,
        result: 'finished'
    };
    if (picked < 0) return {
        state,
        result: 'ignored'
    };
    if (picked !== order[state.current]) return {
        state: {
            ...state,
            mistake: picked
        },
        result: 'wrong'
    };
    return {
        state: {
            current: state.current + 1,
            mistake: -1
        },
        result: 'correct'
    };
}
