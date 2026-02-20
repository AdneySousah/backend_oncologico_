import XLSX from 'xlsx';

// Cabeçalhos exatos que configuramos no sistema
const dados = [
  {
    nome: "João",
    sobrenome: "Silva",
    cpf: "123.456.789-00",
    data_nascimento: "1980-05-20",
    sexo: "M",
    celular: "(11) 99999-0001",
    telefone: "(11) 3333-0000",
    cep: "01001-000", // Praça da Sé - SP (CEP Real para testar a busca de endereço)
    numero: "100",
    complemento: "Apto 101",
    operadora_id: 1,
    possui_cuidador: "NÃO",
    nome_cuidador: "",
    contato_cuidador: ""
  },
  {
    nome: "Maria",
    sobrenome: "Oliveira",
    cpf: "234.567.890-11",
    data_nascimento: "1992-11-15",
    sexo: "F",
    celular: "(21) 98888-0002",
    telefone: "",
    cep: "20040-002", // Rio de Janeiro (CEP Real)
    numero: "50",
    complemento: "",
    operadora_id: 1,
    possui_cuidador: "SIM",
    nome_cuidador: "Fernanda Lima",
    contato_cuidador: "(21) 97777-1234"
  },
  {
    nome: "Carlos",
    sobrenome: "Santos",
    cpf: "345.678.901-22",
    data_nascimento: "1955-03-30",
    sexo: "M",
    celular: "(31) 99988-7766",
    telefone: "(31) 3222-1111",
    cep: "30130-000", // Belo Horizonte (CEP Real)
    numero: "1500",
    complemento: "Casa",
    operadora_id: 1,
    possui_cuidador: "SIM",
    nome_cuidador: "Roberto Dias",
    contato_cuidador: "(31) 98888-5555"
  },
  {
    nome: "Ana",
    sobrenome: "Pereira",
    cpf: "456.789.012-33",
    data_nascimento: "1988-07-07",
    sexo: "F",
    celular: "(41) 99111-2222",
    telefone: "",
    cep: "80020-000", // Curitiba (CEP Real)
    numero: "20",
    complemento: "Bloco B",
    operadora_id: 1,
    possui_cuidador: "NÃO",
    nome_cuidador: "",
    contato_cuidador: ""
  },
  {
    nome: "Pedro",
    sobrenome: "Costa",
    cpf: "567.890.123-44",
    data_nascimento: "1975-12-25",
    sexo: "M",
    celular: "(51) 99333-4444",
    telefone: "",
    cep: "90010-150", // Porto Alegre (CEP Real)
    numero: "333",
    complemento: "",
    operadora_id: 1,
    possui_cuidador: "NÃO",
    nome_cuidador: "",
    contato_cuidador: ""
  }
];

// Cria a planilha
const worksheet = XLSX.utils.json_to_sheet(dados);
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, worksheet, "Pacientes");

// Salva o arquivo
XLSX.writeFile(workbook, "pacientes_teste.xlsx");

console.log("Arquivo 'pacientes_teste.xlsx' criado com sucesso!");