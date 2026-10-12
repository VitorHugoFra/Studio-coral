/**
 * A PRÓXIMA chamada de repo[method] consulta o banco e, antes de devolver o resultado,
 * executa during(): é outro pedido chegando no meio do caminho (leitura, decisão, escrita).
 * Só a primeira chamada é interceptada; depois o método original volta a valer.
 */
function interleave(repo, method, during) {
  const original = repo[method].bind(repo);
  repo[method] = async (...args) => {
    delete repo[method];
    const result = await original(...args);
    await during(result);
    return result;
  };
}

module.exports = { interleave };
