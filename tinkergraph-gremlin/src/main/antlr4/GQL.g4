/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
grammar GQL;

/*********************************************
    PARSER RULES
**********************************************/

matchStatement
    : MATCH patternList EOF
    ;

patternList
    : pattern (COMMA pattern)*
    ;

pattern
    : nodePattern (edgePattern nodePattern)*
    ;

nodePattern
    : LPAREN nodeContents? RPAREN
    ;

nodeContents
    : variable (COLON label)?
    | COLON label
    ;

edgePattern
    : inEdge
    | outEdge
    | undirectedEdge
    ;

inEdge
    : LT DASH LBRACKET edgeContents? RBRACKET DASH
    ;

outEdge
    : DASH LBRACKET edgeContents? RBRACKET DASH GT
    ;

undirectedEdge
    : DASH LBRACKET edgeContents? RBRACKET DASH
    ;

edgeContents
    : variable (COLON label)?
    | COLON label
    ;

variable
    : ID
    ;

label
    : ID
    ;

/*********************************************
    LEXER RULES
**********************************************/

MATCH    : [Mm][Aa][Tt][Cc][Hh] ;
COMMA    : ',' ;
LPAREN   : '(' ;
RPAREN   : ')' ;
LBRACKET : '[' ;
RBRACKET : ']' ;
DASH     : '-' ;
GT       : '>' ;
LT       : '<' ;
COLON    : ':' ;
ID       : [a-zA-Z_][a-zA-Z_0-9]* ;
WS       : [ \t\n\r]+ -> skip ;
